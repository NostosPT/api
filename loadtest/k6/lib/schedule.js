// Load schedule per profile: [{ rate, ramp, hold }] in page views/s and
// seconds. Plain JS with no k6 imports, so run.sh can compute the same
// schedule in Node for the run metadata.

export function durationSeconds(value) {
	const match = /^(\d+)(s|m|h)$/.exec(value);

	if (!match) {
		throw new Error(`Invalid duration: ${value}`);
	}

	return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}

export function schedule(env) {
	const profile = env.LT_PROFILE ?? "smoke";

	if (profile === "stress") {
		const steps = (env.LT_STEPS ?? "1,2,3,4,6,8,10,15,20,30,45,60,80,100").split(",").map(Number);
		const ramp = Number(env.LT_RAMP_SECONDS ?? 20);
		const hold = Number(env.LT_STEP_SECONDS ?? 120);
		return steps.map((rate) => ({ rate, ramp, hold }));
	}

	const rate = Number(env.LT_RATE ?? 0);

	if (profile === "soak") {
		return [{ rate, ramp: 60, hold: durationSeconds(env.LT_DURATION ?? "2h") }];
	}

	if (profile === "spike") {
		const base = Math.max(1, Math.round(rate * 0.3));
		return [
			{ rate: base, ramp: 30, hold: 300 },
			{ rate: rate * 2, ramp: 10, hold: 120 },
			{ rate: base, ramp: 10, hold: 300 },
		];
	}

	return [];
}
