// k6 entry point. LT_PROFILE selects the run:
//
//   smoke   every endpoint once + a short pass of each journey (correctness)
//   stress  public page views step up until the SLO breaks; staff and
//           uploaders run alongside at a fixed, realistic size
//   soak    constant load (LT_RATE page views/s) for LT_DURATION
//   spike   baseline 30% of LT_RATE, sudden jump to 2x LT_RATE, recovery
//
// Public traffic is an open model (ramping/constant-arrival-rate): page views
// keep arriving at the target rate however slow the API gets, so p95/p99 are
// not flattered by coordinated omission. Every sample is tagged with the load
// `step` and `phase` (ramp | hold), so the report can evaluate the SLO per
// step on hold periods only.
import exec from "k6/execution";
import { coverageIteration } from "./journeys/coverage.js";
import { publicPageView } from "./journeys/public.js";
import { staffIteration } from "./journeys/staff.js";
import { uploaderIteration } from "./journeys/uploader.js";
import { ipFor } from "./lib/http.js";
import { schedule } from "./lib/schedule.js";

const PROFILE = __ENV.LT_PROFILE ?? "smoke";
const STAFF_VUS = Number(__ENV.LT_STAFF_VUS ?? 10);
const UPLOAD_VUS = Number(__ENV.LT_UPLOAD_VUS ?? 1);
// In-flight page views cap. Concurrency = rate x latency, so hitting this cap
// means the API has fallen far behind; further page views are dropped (and
// counted) instead of piling up.
const MAX_VUS = Number(__ENV.LT_MAX_VUS ?? 600);
// Distinct simulated visitors (one X-Forwarded-For each). With 50k visitors
// no single IP gets near the 100 req / 15 min global rate limit.
const VISITOR_POOL = Number(__ENV.LT_VISITOR_POOL ?? 50_000);

const SCHEDULE = schedule(__ENV);
const TOTAL_SECONDS = SCHEDULE.reduce((sum, s) => sum + s.ramp + s.hold, 0);

if (PROFILE !== "smoke" && (SCHEDULE.length === 0 || SCHEDULE.some((s) => !(s.rate > 0)))) {
	throw new Error(`LT_PROFILE=${PROFILE} needs a positive LT_RATE (page views/s); see loadtest/README.md`);
}

function tagStep() {
	const elapsed = (Date.now() - exec.scenario.startTime) / 1000;
	let start = 0;

	for (let i = 0; i < SCHEDULE.length; i++) {
		const { ramp, hold } = SCHEDULE[i];

		if (elapsed < start + ramp + hold) {
			exec.vu.metrics.tags.step = String(i);
			exec.vu.metrics.tags.phase = elapsed < start + ramp ? "ramp" : "hold";
			return;
		}

		start += ramp + hold;
	}

	exec.vu.metrics.tags.step = String(SCHEDULE.length - 1);
	exec.vu.metrics.tags.phase = "tail";
}

// --- Scenarios -------------------------------------------------------------------

function publicScenario() {
	const stages = [];

	// Rates are page views per second; k6 needs whole numbers per time unit, so
	// schedule per minute to allow fractional rates like 0.5/s.
	for (const { rate, ramp, hold } of SCHEDULE) {
		const perMinute = Math.round(rate * 60);
		stages.push({ duration: `${ramp}s`, target: perMinute }, { duration: `${hold}s`, target: perMinute });
	}

	return {
		executor: "ramping-arrival-rate",
		exec: "visitor",
		startRate: 0,
		timeUnit: "1m",
		preAllocatedVUs: Math.min(200, MAX_VUS),
		maxVUs: MAX_VUS,
		stages,
	};
}

function backgroundScenarios(duration) {
	const scenarios = {
		staff: { executor: "constant-vus", exec: "staff", vus: STAFF_VUS, duration: `${duration}s`, gracefulStop: "30s" },
	};

	if (UPLOAD_VUS > 0 && __ENV.LT_UPLOADS_DIR) {
		scenarios.uploader = { executor: "constant-vus", exec: "uploader", vus: UPLOAD_VUS, duration: `${duration}s`, gracefulStop: "3m" };
	}

	return scenarios;
}

function scenarios() {
	if (PROFILE === "smoke") {
		return {
			coverage: { executor: "per-vu-iterations", exec: "coverage", vus: 1, iterations: 1 },
			visitor: { executor: "constant-arrival-rate", exec: "visitor", rate: 1, timeUnit: "1s", duration: "60s", preAllocatedVUs: 10, maxVUs: 50, startTime: "5s" },
			staff: { executor: "constant-vus", exec: "staff", vus: 2, duration: "60s", startTime: "5s" },
			...(__ENV.LT_UPLOADS_DIR ? { uploader: { executor: "per-vu-iterations", exec: "uploader", vus: 1, iterations: 1, startTime: "5s", maxDuration: "3m" } } : {}),
		};
	}

	return { visitor: publicScenario(), ...backgroundScenarios(TOTAL_SECONDS) };
}

export const options = {
	scenarios: scenarios(),
	summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
	// Keep metrics lean: the report groups by these tags only.
	systemTags: ["status", "method", "name", "scenario", "group", "check", "expected_response", "error_code"],
	discardResponseBodies: false,
	thresholds: {
		// The SLO. Expected to fail at the top steps of a stress run (that is
		// the point); the per-step verdict is in the report.
		"http_req_duration{kind:public}": ["p(95)<500", "p(99)<1000"],
		"http_req_duration{kind:staff}": ["p(95)<500", "p(99)<1000"],
		"http_req_failed{kind:public}": ["rate<0.01"],
		"http_req_failed{kind:staff}": ["rate<0.01"],
		"checks{kind:coverage}": ["rate==1"],
		// Safety net: stop a run that has clearly collapsed.
		http_req_failed: [{ threshold: "rate<0.3", abortOnFail: true, delayAbortEval: "2m" }],
		dropped_iterations: [{ threshold: "count<3000", abortOnFail: true }],
	},
	setupTimeout: "2m",
};

export function setup() {
	return { profile: PROFILE, schedule: SCHEDULE, startedAt: Date.now() };
}

export function visitor() {
	tagStep();
	publicPageView({ ip: ipFor(Math.floor(Math.random() * VISITOR_POOL)) });
}

export function staff() {
	tagStep();
	staffIteration();
}

export async function uploader() {
	tagStep();
	await uploaderIteration();
}

export async function coverage() {
	await coverageIteration();
}
