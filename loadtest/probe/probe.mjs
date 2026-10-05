// Load-test metrics probe, preloaded into the API process with
// NODE_OPTIONS=--import=/probe/probe.mjs (loadtest/compose.yml only).
//
// Serves GET / on PROBE_PORT with process internals that container-level
// stats can't see: event-loop delay and utilization, V8 heap, GC pauses and
// open sockets. Every read returns values for the interval since the previous
// read, so the collector should be its only consumer. Touches no application
// state.
import { createServer } from "node:http";
import { constants, monitorEventLoopDelay, performance, PerformanceObserver } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";

const port = Number.parseInt(process.env.PROBE_PORT ?? "9464", 10);

const RESOLUTION_MS = 10;
const delay = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
delay.enable();

const GC_KINDS = {
	[constants.NODE_PERFORMANCE_GC_MINOR]: "minor",
	[constants.NODE_PERFORMANCE_GC_MAJOR]: "major",
	[constants.NODE_PERFORMANCE_GC_INCREMENTAL]: "incremental",
	[constants.NODE_PERFORMANCE_GC_WEAKCB]: "weakcb",
};

let gc = freshGc();

function freshGc() {
	return { count: 0, totalMs: 0, maxMs: 0, byKind: {} };
}

new PerformanceObserver((list) => {
	for (const entry of list.getEntries()) {
		const kind = GC_KINDS[entry.detail?.kind] ?? "other";
		gc.count += 1;
		gc.totalMs += entry.duration;
		gc.maxMs = Math.max(gc.maxMs, entry.duration);
		gc.byKind[kind] = (gc.byKind[kind] ?? 0) + entry.duration;
	}
}).observe({ entryTypes: ["gc"] });

let lastCpu = process.cpuUsage();
let lastTime = process.hrtime.bigint();
let lastElu = performance.eventLoopUtilization();

function ms(ns) {
	return Number(ns) / 1e6;
}

// The histogram measures the full timer interval; subtract the sampling
// resolution so the value is the actual event-loop lag.
function lag(ns) {
	return Math.max(0, ms(ns) - RESOLUTION_MS);
}

function sample() {
	const now = process.hrtime.bigint();
	const elapsedUs = Number(now - lastTime) / 1e3;
	const cpu = process.cpuUsage(lastCpu);
	const elu = performance.eventLoopUtilization(lastElu);
	const mem = process.memoryUsage();
	const heap = getHeapStatistics();
	const resources = {};

	for (const name of process.getActiveResourcesInfo()) {
		resources[name] = (resources[name] ?? 0) + 1;
	}

	const result = {
		ts: Date.now(),
		intervalMs: elapsedUs / 1e3,
		// Percent of one core; can exceed 100 with libuv worker threads (argon2,
		// crypto, zlib) running alongside the main thread.
		cpuPercent: ((cpu.user + cpu.system) / elapsedUs) * 100,
		cpuUserPercent: (cpu.user / elapsedUs) * 100,
		cpuSystemPercent: (cpu.system / elapsedUs) * 100,
		memory: {
			rss: mem.rss,
			heapTotal: mem.heapTotal,
			heapUsed: mem.heapUsed,
			external: mem.external,
			arrayBuffers: mem.arrayBuffers,
			heapLimit: heap.heap_size_limit,
		},
		eventLoop: {
			utilization: elu.utilization,
			delayMeanMs: lag(delay.mean),
			delayP50Ms: lag(delay.percentile(50)),
			delayP99Ms: lag(delay.percentile(99)),
			delayMaxMs: lag(delay.max),
		},
		gc: { ...gc, byKind: { ...gc.byKind } },
		sockets: resources.TCPSocketWrap ?? 0,
		activeResources: resources,
	};

	delay.reset();
	gc = freshGc();
	lastCpu = process.cpuUsage();
	lastTime = now;
	lastElu = performance.eventLoopUtilization();

	return result;
}

const server = createServer((request, response) => {
	if (request.method !== "GET") {
		response.writeHead(405).end();
		return;
	}

	response.writeHead(200, { "content-type": "application/json" });
	response.end(JSON.stringify(sample()));
});

server.on("error", (error) => {
	// Never take the API down because of the probe.
	console.error(`[loadtest-probe] disabled: ${error.message}`);
});

server.listen(port, "0.0.0.0");
server.unref();
