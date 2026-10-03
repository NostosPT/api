// Builds <run>/report.html (self-contained) and <run>/result.json from a run
// directory produced by loadtest/run.sh:
//
//   meta.json        run settings (profile, schedule, caps, assumptions)
//   k6.csv.gz        every k6 sample (tagged: name, kind, step, phase)
//   samples.ndjson   resource samples from collect/collector.ts
//   limits.json      container CPU/memory limits
//   db-final.json    pg_stat_statements + plans + table stats
//   pg.log           PostgreSQL slow-statement log for the run window
//
//   tsx loadtest/report/build-report.ts <runDir>
import { createReadStream, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";

const RUN_DIR = process.argv[2];

if (!RUN_DIR) {
	console.error("usage: build-report.ts <runDir>");
	process.exit(1);
}

// --- Inputs --------------------------------------------------------------------

interface Step { rate: number; ramp: number; hold: number }
interface Meta {
	runId: string; profile: string; startedAt: string; endedAt?: string; schedule: Step[];
	slo: { p95Ms: number; p99Ms: number; errorRate: number };
	visitorThinkSeconds: number; staffVus: number; uploadVus: number; caps: string;
	gitSha?: string; seedScale?: number; notes?: string[];
}

async function readJson<T>(file: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path.join(RUN_DIR, file), "utf8")) as T;
	}
	catch {
		return null;
	}
}

const loadedMeta = await readJson<Meta>("meta.json");

if (!loadedMeta) {
	throw new Error(`No meta.json in ${RUN_DIR}`);
}

const meta: Meta = loadedMeta;

// --- k6 samples ----------------------------------------------------------------

type Kind = "public" | "staff" | "upload" | "coverage";

class Series {
	values: number[] = [];
	errors = 0;
	count = 0;
	add(ms: number) { this.values.push(ms); this.count++; }
	percentile(p: number): number | null {
		if (this.values.length === 0) {
			return null;
		}

		if (!this.sorted) {
			this.values.sort((a, b) => a - b);
			this.sorted = true;
		}

		const index = Math.min(this.values.length - 1, Math.ceil((p / 100) * this.values.length) - 1);
		return this.values[Math.max(0, index)];
	}
	get errorRate() { return this.count === 0 ? 0 : this.errors / this.count; }
	private sorted = false;
}

const stepKind = new Map<string, Series>(); // `${step}|${kind}` (hold phase only)
const endpointAll = new Map<string, Series>(); // `${name}`
const endpointStep = new Map<string, Series>(); // `${step}|${name}` (hold only)
const statusCounts = new Map<string, Map<string, number>>(); // name -> status -> n
const iterationsStep = new Map<string, number>(); // `${step}` visitor iterations (hold)
const droppedStep = new Map<string, number>();
const failedChecks = new Map<string, number>();
interface Bucket { reqs: Record<string, number>; errs: Record<string, number>; dur: Record<string, number[]> }
const timeline = new Map<number, Bucket>();
const BUCKET_S = 10;
// Actual hold window per step, from the samples themselves (k6 init time makes
// wall-clock offsets unreliable).
const holdBounds = new Map<string, [number, number]>();
let firstTs = Infinity;
let lastTs = 0;

function get<K, V>(map: Map<K, V>, key: K, make: () => V): V {
	let value = map.get(key);

	if (value === undefined) {
		value = make();
		map.set(key, value);
	}

	return value;
}

function parseCsvLine(line: string): string[] {
	if (!line.includes('"')) {
		return line.split(",");
	}

	const out: string[] = [];
	let current = "";
	let quoted = false;

	for (let i = 0; i < line.length; i++) {
		const c = line[i];

		if (quoted) {
			if (c === '"' && line[i + 1] === '"') { current += '"'; i++; }
			else if (c === '"') { quoted = false; }
			else { current += c; }
		}
		else if (c === '"') { quoted = true; }
		else if (c === ",") { out.push(current); current = ""; }
		else { current += c; }
	}

	out.push(current);
	return out;
}

async function readK6(): Promise<void> {
	const file = path.join(RUN_DIR, "k6.csv.gz");

	if (!existsSync(file)) {
		console.warn("[report] k6.csv.gz missing");
		return;
	}

	const lines = readline.createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
	let header: Record<string, number> | null = null;
	// Pair http_req_failed with its duration sample (same request, same ts).
	const pendingFailed = new Map<string, number>();

	for await (const line of lines) {
		if (header === null) {
			header = Object.fromEntries(parseCsvLine(line).map((h, i) => [h, i]));
			continue;
		}

		const cols = parseCsvLine(line);
		const metric = cols[header.metric_name];

		if (metric !== "http_req_duration" && metric !== "http_req_failed" && metric !== "iterations" && metric !== "dropped_iterations" && metric !== "checks") {
			continue;
		}

		const extra = new URLSearchParams(cols[header.extra_tags] ?? "");
		const kind = (extra.get("kind") ?? "") as Kind | "";
		const step = extra.get("step") ?? "";
		const phase = extra.get("phase") ?? "";
		const ts = Number(cols[header.timestamp]);
		const value = Number(cols[header.metric_value]);
		const name = cols[header.name] ?? "";
		const scenario = cols[header.scenario] ?? "";

		if (metric === "dropped_iterations") {
			if (scenario === "visitor") {
				droppedStep.set(step, (droppedStep.get(step) ?? 0) + value);
			}
			continue;
		}

		if (metric === "iterations") {
			if (scenario === "visitor" && phase === "hold") {
				iterationsStep.set(step, (iterationsStep.get(step) ?? 0) + 1);
			}
			continue;
		}

		if (metric === "checks") {
			if (value === 0) {
				const check = cols[header.check] ?? "";
				failedChecks.set(check, (failedChecks.get(check) ?? 0) + 1);
			}
			continue;
		}

		if (!kind) {
			continue;
		}

		firstTs = Math.min(firstTs, ts);
		lastTs = Math.max(lastTs, ts);

		if (phase === "hold") {
			const bounds = holdBounds.get(step);
			holdBounds.set(step, bounds ? [Math.min(bounds[0], ts), Math.max(bounds[1], ts)] : [ts, ts]);
		}
		const bucket = Math.floor(ts / BUCKET_S) * BUCKET_S;
		const t = get<number, Bucket>(timeline, bucket, () => ({ reqs: {}, errs: {}, dur: {} }));

		if (metric === "http_req_failed") {
			const key = `${ts}|${name}|${kind}`;
			pendingFailed.set(key, value);

			if (value === 1) {
				t.errs[kind] = (t.errs[kind] ?? 0) + 1;
				get(endpointAll, name, () => new Series()).errors++;

				if (phase === "hold") {
					get(stepKind, `${step}|${kind}`, () => new Series()).errors++;
					get(endpointStep, `${step}|${name}`, () => new Series()).errors++;
				}
			}
			continue;
		}

		// http_req_duration
		const status = cols[header.status] ?? "";
		const statuses = get(statusCounts, name, () => new Map());
		statuses.set(status, (statuses.get(status) ?? 0) + 1);
		get(endpointAll, name, () => new Series()).add(value);
		t.reqs[kind] = (t.reqs[kind] ?? 0) + 1;
		(t.dur[kind] ??= []).push(value);

		if (phase === "hold") {
			get(stepKind, `${step}|${kind}`, () => new Series()).add(value);
			get(endpointStep, `${step}|${name}`, () => new Series()).add(value);
		}
	}
}

await readK6();

// --- Resource samples ----------------------------------------------------------

interface Sample {
	ts: number;
	containers: Record<string, { cpuPercent: number | null; memoryBytes: number | null } | null>;
	probe: { cpuPercent: number; memory: { rss: number; heapUsed: number; heapTotal: number; external: number }; eventLoop: { utilization: number; delayP99Ms: number; delayMaxMs: number }; gc: { totalMs: number; maxMs: number }; sockets: number } | null;
	db: { tps: number | null; cacheHitRatio: number | null; connections?: { active: number; idle: number; total: number; waitingLock: number }; rowsReadPerSec: number | null; tempBytesPerSec: number | null; longestActiveMs?: number; error?: string } | null;
}

const samples: Sample[] = [];

if (existsSync(path.join(RUN_DIR, "samples.ndjson"))) {
	for (const line of (await readFile(path.join(RUN_DIR, "samples.ndjson"), "utf8")).split("\n")) {
		if (line.trim()) {
			samples.push(JSON.parse(line) as Sample);
		}
	}
}

const limits = await readJson<Record<string, { cpus: number | null; memoryBytes: number | null }>>("limits.json") ?? {};
const dbFinal = await readJson<{ statements: Record<string, string | number>[]; plans: Record<string, string>; tables: Record<string, string | number | null>[]; unusedIndexes: Record<string, string | number>[]; settings: Record<string, string>[] }>("db-final.json");

// --- Step windows ----------------------------------------------------------------

const runStart = Number.isFinite(firstTs) ? firstTs * 1000 : Date.parse(meta.startedAt);
const windows: { index: number; rate: number; holdStart: number; holdEnd: number }[] = [];
{
	let cursor = runStart;

	meta.schedule.forEach((s, index) => {
		const observed = holdBounds.get(String(index));
		windows.push(observed
			? { index, rate: s.rate, holdStart: observed[0] * 1000, holdEnd: observed[1] * 1000 }
			: { index, rate: s.rate, holdStart: cursor + s.ramp * 1000, holdEnd: cursor + (s.ramp + s.hold) * 1000 });
		cursor += (s.ramp + s.hold) * 1000;
	});
}

function avg(values: number[]): number | null {
	const v = values.filter((x) => Number.isFinite(x));
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function max(values: number[]): number | null {
	const v = values.filter((x) => Number.isFinite(x));
	return v.length ? Math.max(...v) : null;
}

const cpuCap = (key: string) => (limits[key]?.cpus ?? limits.engine?.cpus ?? null);

interface StepResult {
	index: number; targetRate: number; achievedRate: number; visitors: number; dropped: number;
	public: { count: number; rps: number; p50: number | null; p95: number | null; p99: number | null; max: number | null; errorRate: number };
	staff: { count: number; p95: number | null; p99: number | null; errorRate: number };
	upload: { count: number; p95: number | null; errorRate: number };
	resources: { apiCpu: number | null; apiCpuMax: number | null; apiRssMax: number | null; heapMax: number | null; eluAvg: number | null; loopP99Max: number | null; pgCpu: number | null; pgMemMax: number | null; pgActiveAvg: number | null; pgActiveMax: number | null; tps: number | null; cacheHit: number | null; s3Cpu: number | null };
	pass: boolean; reasons: string[];
}

// Steps an aborted run never reached have no samples and are left out.
const steps: StepResult[] = windows.filter((w) => holdBounds.has(String(w.index)) || samples.some((s) => s.ts >= w.holdStart && s.ts <= w.holdEnd)).map((w) => {
	const key = String(w.index);
	const pub = stepKind.get(`${key}|public`) ?? new Series();
	const staff = stepKind.get(`${key}|staff`) ?? new Series();
	const upload = stepKind.get(`${key}|upload`) ?? new Series();
	const holdSeconds = (w.holdEnd - w.holdStart) / 1000;
	const inWindow = samples.filter((s) => s.ts >= w.holdStart && s.ts <= w.holdEnd);
	const iterations = iterationsStep.get(key) ?? 0;
	const achievedRate = holdSeconds > 0 ? iterations / holdSeconds : 0;
	const dropped = droppedStep.get(key) ?? 0;
	const reasons: string[] = [];
	const p95 = pub.percentile(95);
	const p99 = pub.percentile(99);
	const sp95 = staff.percentile(95);
	const sp99 = staff.percentile(99);

	if (pub.count === 0) reasons.push("no public samples");
	if (p95 !== null && p95 >= meta.slo.p95Ms) reasons.push(`public p95 ${fmtMs(p95)}`);
	if (p99 !== null && p99 >= meta.slo.p99Ms) reasons.push(`public p99 ${fmtMs(p99)}`);
	if (pub.errorRate >= meta.slo.errorRate) reasons.push(`public errors ${pct(pub.errorRate)}`);
	if (sp95 !== null && sp95 >= meta.slo.p95Ms) reasons.push(`staff p95 ${fmtMs(sp95)}`);
	if (sp99 !== null && sp99 >= meta.slo.p99Ms) reasons.push(`staff p99 ${fmtMs(sp99)}`);
	if (staff.count > 0 && staff.errorRate >= meta.slo.errorRate) reasons.push(`staff errors ${pct(staff.errorRate)}`);
	if (achievedRate < w.rate * 0.97) reasons.push(`only ${achievedRate.toFixed(1)}/${w.rate} page views/s served`);

	return {
		index: w.index, targetRate: w.rate, achievedRate, visitors: Math.round(achievedRate * meta.visitorThinkSeconds), dropped,
		public: { count: pub.count, rps: holdSeconds > 0 ? pub.count / holdSeconds : 0, p50: pub.percentile(50), p95, p99, max: pub.percentile(100), errorRate: pub.errorRate },
		staff: { count: staff.count, p95: sp95, p99: sp99, errorRate: staff.errorRate },
		upload: { count: upload.count, p95: upload.percentile(95), errorRate: upload.errorRate },
		resources: {
			apiCpu: avg(inWindow.map((s) => s.containers.api?.cpuPercent ?? NaN)),
			apiCpuMax: max(inWindow.map((s) => s.containers.api?.cpuPercent ?? NaN)),
			apiRssMax: max(inWindow.map((s) => s.probe?.memory.rss ?? NaN)),
			heapMax: max(inWindow.map((s) => s.probe?.memory.heapUsed ?? NaN)),
			eluAvg: avg(inWindow.map((s) => s.probe?.eventLoop.utilization ?? NaN)),
			loopP99Max: max(inWindow.map((s) => s.probe?.eventLoop.delayP99Ms ?? NaN)),
			pgCpu: avg(inWindow.map((s) => s.containers.postgres?.cpuPercent ?? NaN)),
			pgMemMax: max(inWindow.map((s) => s.containers.postgres?.memoryBytes ?? NaN)),
			pgActiveAvg: avg(inWindow.map((s) => s.db?.connections?.active ?? NaN)),
			pgActiveMax: max(inWindow.map((s) => s.db?.connections?.active ?? NaN)),
			tps: avg(inWindow.map((s) => s.db?.tps ?? NaN)),
			cacheHit: avg(inWindow.map((s) => s.db?.cacheHitRatio ?? NaN)),
			s3Cpu: avg(inWindow.map((s) => s.containers.seaweedfs?.cpuPercent ?? NaN)),
		},
		pass: reasons.length === 0,
		reasons,
	};
});

// Capacity = the last step before the first failing one.
const firstFail = steps.findIndex((s) => !s.pass);
const sustainable = firstFail === -1 ? steps[steps.length - 1] : firstFail > 0 ? steps[firstFail - 1] : null;
const breaking = firstFail === -1 ? null : steps[firstFail];

function bottleneck(step: StepResult | null): string[] {
	if (!step) {
		return [];
	}

	const r = step.resources;
	const out: string[] = [];
	const apiCap = cpuCap("api");
	const pgCap = cpuCap("postgres");

	if (r.apiCpu !== null && apiCap && r.apiCpu >= apiCap * 100 * 0.85) out.push(`API container CPU saturated (${r.apiCpu.toFixed(0)}% of ${apiCap * 100}% available)`);
	if (r.eluAvg !== null && r.eluAvg >= 0.85) out.push(`API event loop busy ${(r.eluAvg * 100).toFixed(0)}% of the time: requests queue behind JavaScript work`);
	if (r.loopP99Max !== null && r.loopP99Max >= 100) out.push(`event-loop lag p99 up to ${fmtMs(r.loopP99Max)}`);
	if (r.pgCpu !== null && pgCap && r.pgCpu >= pgCap * 100 * 0.85) out.push(`PostgreSQL CPU saturated (${r.pgCpu.toFixed(0)}% of ${pgCap * 100}% available)`);
	if (r.pgActiveMax !== null && r.pgActiveMax >= 9) out.push(`PostgreSQL connections maxed at ${r.pgActiveMax} active (Prisma pg pool defaults to 10): queries wait for a connection`);
	if (r.apiRssMax !== null && limits.api?.memoryBytes && r.apiRssMax >= limits.api.memoryBytes * 0.85) out.push(`API memory near its limit (${fmtBytes(r.apiRssMax)})`);
	if (step.dropped > 0) out.push(`k6 could not start ${step.dropped} page views on time (VU pool exhausted by slow responses)`);

	if (out.length === 0) out.push("no single resource pinned; check per-endpoint latency for one slow route");
	return out;
}

// --- Formatting -------------------------------------------------------------------

function fmtMs(v: number | null | undefined): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return "–";
	return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(v < 10 ? 1 : 0)} ms`;
}

function fmtBytes(v: number | null | undefined): string {
	if (v === null || v === undefined || !Number.isFinite(v)) return "–";
	const units = ["B", "KB", "MB", "GB"];
	let n = v;
	let u = 0;
	while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
	return `${n.toFixed(n < 10 ? 1 : 0)} ${units[u]}`;
}

function pct(v: number | null | undefined, digits = 2): string {
	return v === null || v === undefined || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(digits)}%`;
}

function num(v: number | null | undefined, digits = 0): string {
	return v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(digits);
}

function esc(value: unknown): string {
	return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

// --- Charts (inline SVG, no dependencies) ---------------------------------------

interface Line { label: string; color: string; points: [number, number][]; dashed?: boolean }

function chart(title: string, lines: Line[], opts: { unit?: (v: number) => string; yMax?: number; refLines?: { value: number; label: string }[] } = {}): string {
	const W = 720, H = 220, L = 56, R = 12, T = 12, B = 26;
	const all = lines.flatMap((l) => l.points);

	if (all.length === 0) {
		return `<figure class="chart"><figcaption>${esc(title)}</figcaption><p class="muted">No data.</p></figure>`;
	}

	const x0 = runStart;
	const x1 = Math.max(...all.map((p) => p[0]), x0 + 1000);
	const yMax = opts.yMax ?? Math.max(...all.map((p) => p[1]), ...(opts.refLines ?? []).map((r) => r.value), 1) * 1.08;
	const fmt = opts.unit ?? ((v: number) => num(v, v < 10 ? 1 : 0));
	const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
	const sy = (y: number) => T + (1 - Math.min(y, yMax) / yMax) * (H - T - B);
	const bands = windows.map((w, i) => i % 2 === 0 ? "" : `<rect x="${sx(w.holdStart - meta.schedule[i].ramp * 1000)}" y="${T}" width="${Math.max(0, sx(w.holdEnd) - sx(w.holdStart - meta.schedule[i].ramp * 1000))}" height="${H - T - B}" class="band"/>`).join("");
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${sy(yMax * f)}" y2="${sy(yMax * f)}" class="grid"/><text x="${L - 6}" y="${sy(yMax * f) + 4}" class="tick" text-anchor="end">${esc(fmt(yMax * f))}</text>`).join("");
	const minutes = Math.max(1, Math.round((x1 - x0) / 60000 / 6));
	const xTicks: string[] = [];
	for (let m = 0; m * 60000 <= x1 - x0; m += minutes) {
		xTicks.push(`<text x="${sx(x0 + m * 60000)}" y="${H - 8}" class="tick" text-anchor="middle">${m}m</text>`);
	}
	const refs = (opts.refLines ?? []).map((r) => `<line x1="${L}" x2="${W - R}" y1="${sy(r.value)}" y2="${sy(r.value)}" class="ref"/><text x="${W - R - 4}" y="${sy(r.value) - 4}" class="tick" text-anchor="end">${esc(r.label)}</text>`).join("");
	const paths = lines.map((l) => {
		const d = l.points.sort((a, b) => a[0] - b[0]).map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
		return `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="1.6"${l.dashed ? ' stroke-dasharray="4 3"' : ""}/>`;
	}).join("");
	const legend = lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join("");

	return `<figure class="chart"><figcaption>${esc(title)}<span class="legend">${legend}</span></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${bands}${ticks}${xTicks.join("")}${refs}${paths}</svg></figure>`;
}

const C = { pub: "var(--c1)", staff: "var(--c2)", upload: "var(--c3)", api: "var(--c1)", pg: "var(--c2)", s3: "var(--c3)", p99: "var(--c4)" };
const buckets = [...timeline.entries()].sort((a, b) => a[0] - b[0]);

function bucketPercentile(values: number[] | undefined, p: number): number | null {
	if (!values || values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

// Buckets without any request of that kind are skipped rather than drawn as 0.
function seriesFromBuckets(kind: string, fn: (b: { reqs: Record<string, number>; errs: Record<string, number>; dur: Record<string, number[]> }) => number | null): [number, number][] {
	return buckets
		.filter(([, b]) => (b.reqs[kind] ?? 0) > 0)
		.map(([t, b]) => [t * 1000, fn(b)] as [number, number | null])
		.filter((p): p is [number, number] => p[1] !== null);
}

function sampleSeries(fn: (s: Sample) => number | null | undefined): [number, number][] {
	return samples.map((s) => [s.ts, fn(s)] as [number, number | null | undefined]).filter((p): p is [number, number] => typeof p[1] === "number" && Number.isFinite(p[1]));
}

const charts = [
	chart("Throughput (requests/s)", [
		{ label: "public", color: C.pub, points: seriesFromBuckets("public", (b) => (b.reqs.public ?? 0) / BUCKET_S) },
		{ label: "staff", color: C.staff, points: seriesFromBuckets("staff", (b) => (b.reqs.staff ?? 0) / BUCKET_S) },
	]),
	chart("Public latency (per 10 s)", [
		{ label: "p95", color: C.pub, points: seriesFromBuckets("public", (b) => bucketPercentile(b.dur.public, 95)) },
		{ label: "p99", color: C.p99, points: seriesFromBuckets("public", (b) => bucketPercentile(b.dur.public, 99)) },
	], { unit: (v) => fmtMs(v), refLines: [{ value: meta.slo.p95Ms, label: `p95 SLO ${meta.slo.p95Ms} ms` }, { value: meta.slo.p99Ms, label: `p99 SLO ${meta.slo.p99Ms} ms` }] }),
	chart("Staff latency (per 10 s)", [
		{ label: "p95", color: C.staff, points: seriesFromBuckets("staff", (b) => bucketPercentile(b.dur.staff, 95)) },
		{ label: "p99", color: C.p99, points: seriesFromBuckets("staff", (b) => bucketPercentile(b.dur.staff, 99)) },
	], { unit: (v) => fmtMs(v), refLines: [{ value: meta.slo.p95Ms, label: "p95 SLO" }] }),
	chart("Error rate", [
		{ label: "public", color: C.pub, points: seriesFromBuckets("public", (b) => (b.reqs.public ? (b.errs.public ?? 0) / b.reqs.public : null)) },
		{ label: "staff", color: C.staff, points: seriesFromBuckets("staff", (b) => (b.reqs.staff ? (b.errs.staff ?? 0) / b.reqs.staff : null)) },
	], { unit: (v) => pct(v, 1), refLines: [{ value: meta.slo.errorRate, label: "1% SLO" }] }),
	chart("Container CPU (% of one core)", [
		{ label: "api", color: C.api, points: sampleSeries((s) => s.containers.api?.cpuPercent) },
		{ label: "postgres", color: C.pg, points: sampleSeries((s) => s.containers.postgres?.cpuPercent) },
		{ label: "seaweedfs", color: C.s3, points: sampleSeries((s) => s.containers.seaweedfs?.cpuPercent) },
	], { unit: (v) => `${v.toFixed(0)}%`, refLines: [cpuCap("api") ? { value: cpuCap("api")! * 100, label: "api cap" } : null, cpuCap("postgres") ? { value: cpuCap("postgres")! * 100, label: "postgres cap" } : null].filter((x): x is { value: number; label: string } => x !== null) }),
	chart("Container memory", [
		{ label: "api", color: C.api, points: sampleSeries((s) => s.containers.api?.memoryBytes) },
		{ label: "postgres", color: C.pg, points: sampleSeries((s) => s.containers.postgres?.memoryBytes) },
		{ label: "seaweedfs", color: C.s3, points: sampleSeries((s) => s.containers.seaweedfs?.memoryBytes) },
	], { unit: fmtBytes }),
	chart("API process: heap and RSS", [
		{ label: "rss", color: C.api, points: sampleSeries((s) => s.probe?.memory.rss) },
		{ label: "heap used", color: C.pg, points: sampleSeries((s) => s.probe?.memory.heapUsed) },
		{ label: "external", color: C.s3, points: sampleSeries((s) => s.probe?.memory.external) },
	], { unit: fmtBytes }),
	chart("API event loop", [
		{ label: "lag p99 (ms)", color: C.api, points: sampleSeries((s) => s.probe?.eventLoop.delayP99Ms) },
		{ label: "GC pause total per sample (ms)", color: C.pg, points: sampleSeries((s) => s.probe?.gc.totalMs) },
	]),
	chart("API event-loop utilization", [
		{ label: "utilization", color: C.api, points: sampleSeries((s) => s.probe?.eventLoop.utilization) },
	], { unit: (v) => pct(v, 0), yMax: 1.05 }),
	chart("PostgreSQL connections", [
		{ label: "active", color: C.pg, points: sampleSeries((s) => s.db?.connections?.active) },
		{ label: "total", color: C.api, points: sampleSeries((s) => s.db?.connections?.total), dashed: true },
		{ label: "waiting on locks", color: C.p99, points: sampleSeries((s) => s.db?.connections?.waitingLock) },
	]),
	chart("PostgreSQL transactions/s and rows read/s (÷1000)", [
		{ label: "tx/s", color: C.pg, points: sampleSeries((s) => s.db?.tps) },
		{ label: "rows read/s ÷ 1000", color: C.api, points: sampleSeries((s) => (s.db?.rowsReadPerSec ?? NaN) / 1000) },
	]),
	chart("PostgreSQL cache hit ratio", [
		{ label: "hit ratio", color: C.pg, points: sampleSeries((s) => s.db?.cacheHitRatio) },
	], { unit: (v) => pct(v, 1), yMax: 1.02 }),
];

// --- Tables -------------------------------------------------------------------

const endpointRows = [...endpointAll.entries()]
	.map(([name, s]) => ({ name, count: s.count, p50: s.percentile(50), p95: s.percentile(95), p99: s.percentile(99), max: s.percentile(100), errorRate: s.errorRate, statuses: [...(statusCounts.get(name) ?? new Map()).entries()].sort().map(([k, v]) => `${k}×${v}`).join(" ") }))
	.sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));

function endpointAtStep(step: StepResult | null) {
	if (!step) return new Map<string, { p95: number | null; p99: number | null }>();
	const out = new Map<string, { p95: number | null; p99: number | null }>();
	for (const [key, s] of endpointStep) {
		const [idx, name] = key.split("|");
		if (idx === String(step.index)) out.set(name, { p95: s.percentile(95), p99: s.percentile(99) });
	}
	return out;
}

const atSustainable = endpointAtStep(sustainable);
const atBreak = endpointAtStep(breaking);

const slowLog: { ms: number; text: string }[] = [];

if (existsSync(path.join(RUN_DIR, "pg.log"))) {
	for (const line of (await readFile(path.join(RUN_DIR, "pg.log"), "utf8")).split("\n")) {
		const m = /duration: ([\d.]+) ms\s+(?:statement|execute [^:]*): (.*)$/.exec(line);
		if (m) slowLog.push({ ms: Number(m[1]), text: m[2] });
	}
}

slowLog.sort((a, b) => b.ms - a.ms);

const statements = dbFinal?.statements ?? [];
const totalDbTime = statements.reduce((sum, s) => sum + Number(s.total_exec_time), 0);

const isStepped = meta.profile === "stress";
const headline = !isStepped
	? `${meta.profile} run`
	: sustainable
		? `Sustains ${sustainable.achievedRate.toFixed(1)} page views/s ≈ ${sustainable.visitors.toLocaleString("en")} concurrent visitors`
		: "Did not meet the SLO even at the first step";

const stepRows = steps.map((s) => `
	<tr class="${s.pass ? "pass" : "fail"}${sustainable?.index === s.index ? " best" : ""}">
		<td>${s.index + 1}</td><td>${s.targetRate}</td><td>${s.achievedRate.toFixed(1)}</td><td>${s.visitors.toLocaleString("en")}</td>
		<td>${s.public.rps.toFixed(1)}</td><td>${fmtMs(s.public.p50)}</td><td>${fmtMs(s.public.p95)}</td><td>${fmtMs(s.public.p99)}</td><td>${pct(s.public.errorRate)}</td>
		<td>${fmtMs(s.staff.p95)}</td><td>${fmtMs(s.staff.p99)}</td>
		<td>${num(s.resources.apiCpu)}%</td><td>${pct(s.resources.eluAvg, 0)}</td><td>${fmtMs(s.resources.loopP99Max)}</td><td>${fmtBytes(s.resources.apiRssMax)}</td>
		<td>${num(s.resources.pgCpu)}%</td><td>${num(s.resources.pgActiveAvg, 1)} / ${num(s.resources.pgActiveMax)}</td><td>${num(s.resources.tps)}</td>
		<td>${s.pass ? "✓" : esc(s.reasons.join("; "))}</td>
	</tr>`).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nostos Load Test</title>
<style>
:root { --bg:#fbfaf8; --fg:#1d1c1a; --muted:#6b6862; --line:#e4e1dc; --card:#ffffff; --pass:#e6f2ea; --fail:#fbe9e7; --best:#cfe8d6;
	--c1:#2f6fb5; --c2:#c4622d; --c3:#5b8c3a; --c4:#8e3b8e; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#161615; --fg:#ecebe8; --muted:#a19d96; --line:#33312e; --card:#1f1e1c; --pass:#1e3324; --fail:#3a2220; --best:#24452e;
	--c1:#6fa3e0; --c2:#e58a55; --c3:#8cc06a; --c4:#c87ac8; color-scheme: dark; } }
:root[data-theme="dark"] { --bg:#161615; --fg:#ecebe8; --muted:#a19d96; --line:#33312e; --card:#1f1e1c; --pass:#1e3324; --fail:#3a2220; --best:#24452e; --c1:#6fa3e0; --c2:#e58a55; --c3:#8cc06a; --c4:#c87ac8; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
main { max-width:1180px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:16px; margin:36px 0 10px; border-bottom:1px solid var(--line); padding-bottom:6px; }
.muted { color:var(--muted); } code, pre { font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px; margin:18px 0; }
.kpi { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
.kpi b { display:block; font-size:20px; font-variant-numeric:tabular-nums; } .kpi span { color:var(--muted); font-size:12px; }
.scroll { overflow-x:auto; border:1px solid var(--line); border-radius:8px; background:var(--card); }
table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; font-size:12.5px; }
th, td { padding:5px 8px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }
th { position:sticky; top:0; background:var(--card); color:var(--muted); font-weight:600; }
td:first-child, th:first-child, td.l, th.l { text-align:left; } td.wrap { white-space:normal; text-align:left; min-width:280px; }
tr.pass td { background:var(--pass); } tr.fail td { background:var(--fail); } tr.best td { background:var(--best); font-weight:600; }
.charts { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 520px), 1fr)); gap:12px; }
.chart { margin:0; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
.chart figcaption { font-weight:600; font-size:13px; display:flex; flex-wrap:wrap; gap:4px 12px; align-items:baseline; }
.legend { font-weight:400; color:var(--muted); font-size:12px; display:flex; gap:10px; flex-wrap:wrap; }
.legend i { display:inline-block; width:10px; height:3px; margin-right:4px; vertical-align:middle; }
svg { width:100%; height:auto; display:block; } .grid { stroke:var(--line); } .tick { fill:var(--muted); font-size:10px; }
.band { fill:var(--fg); opacity:.035; } .ref { stroke:var(--c4); stroke-dasharray:3 4; opacity:.7; }
ul.findings li { margin:4px 0; } details { margin:6px 0; } summary { cursor:pointer; }
pre { white-space:pre-wrap; background:var(--card); border:1px solid var(--line); border-radius:6px; padding:8px; overflow-x:auto; }
</style></head><body><main>
<h1>${esc(headline)}</h1>
<p class="muted">Run <code>${esc(meta.runId)}</code> · profile <b>${esc(meta.profile)}</b> · ${esc(meta.startedAt)} → ${esc(meta.endedAt ?? "")} · git ${esc(meta.gitSha ?? "?")} · seed scale ${esc(meta.seedScale ?? "?")} · resources: ${esc(meta.caps)}</p>
<p class="muted">SLO: p95 &lt; ${meta.slo.p95Ms} ms, p99 &lt; ${meta.slo.p99Ms} ms, errors &lt; ${pct(meta.slo.errorRate, 0)} for both public and staff traffic, measured on each step's hold period. Concurrent visitors = page views/s × ${meta.visitorThinkSeconds} s average time between page views. Staff: ${meta.staffVus} concurrent, uploaders: ${meta.uploadVus}.</p>

<div class="kpis">
	<div class="kpi"><span>Max sustainable load</span><b>${sustainable ? `${sustainable.achievedRate.toFixed(1)} pv/s` : "–"}</b><span>${sustainable ? `≈ ${sustainable.visitors.toLocaleString("en")} visitors · ${sustainable.public.rps.toFixed(1)} public req/s` : ""}</span></div>
	<div class="kpi"><span>p95 / p99 at that load (public)</span><b>${sustainable ? `${fmtMs(sustainable.public.p95)} / ${fmtMs(sustainable.public.p99)}` : "–"}</b><span>staff ${sustainable ? `${fmtMs(sustainable.staff.p95)} / ${fmtMs(sustainable.staff.p99)}` : "–"}</span></div>
	<div class="kpi"><span>Breaks at</span><b>${breaking ? `${breaking.targetRate} pv/s` : "not reached"}</b><span>${breaking ? esc(breaking.reasons.join("; ")) : ""}</span></div>
	<div class="kpi"><span>API at max load</span><b>${sustainable ? `${num(sustainable.resources.apiCpu)}% CPU` : "–"}</b><span>${sustainable ? `RSS ${fmtBytes(sustainable.resources.apiRssMax)} · ELU ${pct(sustainable.resources.eluAvg, 0)}` : ""}</span></div>
	<div class="kpi"><span>PostgreSQL at max load</span><b>${sustainable ? `${num(sustainable.resources.pgCpu)}% CPU` : "–"}</b><span>${sustainable ? `${num(sustainable.resources.tps)} tx/s · ${num(sustainable.resources.pgActiveMax)} active conns` : ""}</span></div>
</div>

${breaking ? `<h2>What gave out first</h2><ul class="findings">${bottleneck(breaking).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
${failedChecks.size ? `<h2>Failed checks</h2><div class="scroll"><table><tr><th class="l">Check</th><th>Failures</th></tr>${[...failedChecks.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td class="l">${esc(k)}</td><td>${v}</td></tr>`).join("")}</table></div>` : ""}

${steps.length ? `<h2>Load steps</h2>
<div class="scroll"><table>
<tr><th>#</th><th>Target pv/s</th><th>Served pv/s</th><th>≈ Visitors</th><th>Public req/s</th><th>p50</th><th>p95</th><th>p99</th><th>Errors</th><th>Staff p95</th><th>Staff p99</th><th>API CPU</th><th>ELU</th><th>Loop lag p99</th><th>API RSS</th><th>PG CPU</th><th>PG active avg/max</th><th>PG tx/s</th><th class="l">Verdict</th></tr>
${stepRows}
</table></div>` : ""}

<h2>Timeline</h2>
<p class="muted">Shaded bands mark alternate load steps.</p>
<div class="charts">${charts.join("")}</div>

<h2>Endpoints</h2>
<p class="muted">Whole run, sorted by p95. "At max" and "at break" columns are the hold periods of those steps.</p>
<div class="scroll"><table>
<tr><th class="l">Endpoint</th><th>Requests</th><th>p50</th><th>p95</th><th>p99</th><th>Max</th><th>Errors</th><th>p95 at max</th><th>p99 at max</th><th>p95 at break</th><th class="l">Statuses</th></tr>
${endpointRows.map((e) => `<tr><td class="l"><code>${esc(e.name)}</code></td><td>${e.count}</td><td>${fmtMs(e.p50)}</td><td>${fmtMs(e.p95)}</td><td>${fmtMs(e.p99)}</td><td>${fmtMs(e.max)}</td><td>${pct(e.errorRate)}</td><td>${fmtMs(atSustainable.get(e.name)?.p95)}</td><td>${fmtMs(atSustainable.get(e.name)?.p99)}</td><td>${fmtMs(atBreak.get(e.name)?.p95)}</td><td class="l muted">${esc(e.statuses)}</td></tr>`).join("")}
</table></div>

<h2>Database: top statements</h2>
<p class="muted">pg_stat_statements for the run, by total execution time (${fmtMs(totalDbTime)} total). Plans are generic (no parameter values).</p>
<div class="scroll"><table>
<tr><th class="l">Statement</th><th>Calls</th><th>Total</th><th>Share</th><th>Mean</th><th>Max</th><th>Rows/call</th><th>Cache hit</th></tr>
${statements.slice(0, 20).map((s) => {
	const hit = Number(s.shared_blks_hit), read = Number(s.shared_blks_read);
	return `<tr><td class="wrap"><details><summary><code>${esc(String(s.query).slice(0, 140))}${String(s.query).length > 140 ? "…" : ""}</code></summary><pre>${esc(s.query)}</pre>${dbFinal?.plans[String(s.queryid)] ? `<pre>${esc(dbFinal.plans[String(s.queryid)])}</pre>` : ""}</details></td><td>${s.calls}</td><td>${fmtMs(Number(s.total_exec_time))}</td><td>${pct(Number(s.total_exec_time) / (totalDbTime || 1), 1)}</td><td>${fmtMs(Number(s.mean_exec_time))}</td><td>${fmtMs(Number(s.max_exec_time))}</td><td>${num(Number(s.rows) / Math.max(1, Number(s.calls)), 1)}</td><td>${hit + read ? pct(hit / (hit + read), 1) : "–"}</td></tr>`;
}).join("")}
</table></div>

<h2>Database: tables</h2>
<div class="scroll"><table>
<tr><th class="l">Table</th><th>Seq scans</th><th>Rows read by seq scans</th><th>Index scans</th><th>Live rows</th><th>Dead rows</th><th>Inserts</th><th>Updates</th><th>Size</th></tr>
${(dbFinal?.tables ?? []).slice(0, 25).map((t) => `<tr><td class="l">${esc(t.table)}</td><td>${t.seq_scan}</td><td>${Number(t.seq_tup_read).toLocaleString("en")}</td><td>${t.idx_scan ?? "–"}</td><td>${Number(t.n_live_tup).toLocaleString("en")}</td><td>${Number(t.n_dead_tup).toLocaleString("en")}</td><td>${t.n_tup_ins}</td><td>${t.n_tup_upd}</td><td>${fmtBytes(Number(t.total_bytes))}</td></tr>`).join("")}
</table></div>

${slowLog.length ? `<h2>Slow statement log (&gt; 500 ms)</h2><p class="muted">${slowLog.length} statements logged; slowest 15.</p><div class="scroll"><table><tr><th>Duration</th><th class="l">Statement</th></tr>${slowLog.slice(0, 15).map((s) => `<tr><td>${fmtMs(s.ms)}</td><td class="wrap"><code>${esc(s.text.slice(0, 400))}</code></td></tr>`).join("")}</table></div>` : ""}

<h2>Run settings</h2>
<pre>${esc(JSON.stringify({ ...meta, limits, pgSettings: dbFinal?.settings }, null, 2))}</pre>
</main></body></html>`;

await writeFile(path.join(RUN_DIR, "report.html"), html);

const result = {
	runId: meta.runId,
	profile: meta.profile,
	sustainable: sustainable && { step: sustainable.index + 1, pageViewsPerSec: sustainable.achievedRate, concurrentVisitors: sustainable.visitors, publicReqPerSec: sustainable.public.rps, public: sustainable.public, staff: sustainable.staff, resources: sustainable.resources },
	breaking: breaking && { step: breaking.index + 1, targetRate: breaking.targetRate, reasons: breaking.reasons, bottleneck: bottleneck(breaking) },
	steps,
	endpoints: endpointRows,
	failedChecks: Object.fromEntries(failedChecks),
};

await writeFile(path.join(RUN_DIR, "result.json"), JSON.stringify(result, null, 2));

// Terminal summary.
console.log(`\n${headline}`);

for (const s of steps) {
	console.log(`  step ${String(s.index + 1).padStart(2)}  ${String(s.targetRate).padStart(5)} pv/s  served ${s.achievedRate.toFixed(1).padStart(6)}  p95 ${fmtMs(s.public.p95).padStart(8)}  p99 ${fmtMs(s.public.p99).padStart(8)}  err ${pct(s.public.errorRate).padStart(7)}  staff p95 ${fmtMs(s.staff.p95).padStart(8)}  api ${num(s.resources.apiCpu).padStart(3)}%  pg ${num(s.resources.pgCpu).padStart(3)}%  ${s.pass ? "PASS" : `FAIL (${s.reasons.join("; ")})`}`);
}

if (breaking) {
	console.log(`\nBottleneck at step ${breaking.index + 1}:`);
	for (const b of bottleneck(breaking)) console.log(`  - ${b}`);
}

console.log(`\nReport: ${path.join(RUN_DIR, "report.html")}`);
