import type { CheckResult, HealthComponent, HealthStatus } from "./types.js";

const SEVERITY: Record<HealthStatus, number> = { UP: 0, DEGRADED: 1, DOWN: 2 };

export interface Transition {
	component: HealthComponent;
	// null = first confirmed state since the process started.
	from: HealthStatus | null;
	to: HealthStatus;
	// checkedAt of the first result of the streak that caused the change.
	since: Date;
	errorCode: string | null;
}

interface ComponentState {
	confirmed: HealthStatus | null;
	direction: "worse" | "better" | null;
	streak: number;
	streakStart: Date | null;
}

export interface StateTrackerOptions {
	// Consecutive worse results needed to confirm a degradation/outage.
	failureThreshold: number;
	// Consecutive better results needed to confirm an improvement.
	recoveryThreshold: number;
}

// Debounces probe results into confirmed state changes, per component.
// A streak counts consecutive results that are all worse (or all better)
// than the confirmed state, so DOWN/DEGRADED/DOWN still confirms an outage;
// a change of direction or a result equal to the confirmed state resets it.
// The confirmed state becomes the latest status of the completed streak.
// Kept in memory only: a restart starts from unknown again.
export class StateTracker {
	private readonly states = new Map<HealthComponent, ComponentState>();

	constructor(private readonly options: StateTrackerOptions) {}

	current(component: HealthComponent): HealthStatus | null {
		return this.states.get(component)?.confirmed ?? null;
	}

	observe(result: CheckResult): Transition | null {
		const state = this.states.get(result.component) ?? { confirmed: null, direction: null, streak: 0, streakStart: null };

		this.states.set(result.component, state);

		if (result.status === state.confirmed) {
			this.resetStreak(state);

			return null;
		}

		// Unknown counts as UP for direction: a healthy start confirms at once
		// (nothing to report), a failing start needs the full failure streak.
		const baseline = SEVERITY[state.confirmed ?? "UP"];
		const direction = SEVERITY[result.status] > baseline ? "worse" : "better";

		if (state.confirmed === null && result.status === "UP") {
			state.confirmed = "UP";
			this.resetStreak(state);

			return { component: result.component, from: null, to: "UP", since: result.checkedAt, errorCode: null };
		}

		if (direction !== state.direction) {
			state.direction = direction;
			state.streak = 0;
			state.streakStart = result.checkedAt;
		}

		state.streak += 1;

		const threshold = direction === "worse" ? this.options.failureThreshold : this.options.recoveryThreshold;

		if (state.streak < threshold) {
			return null;
		}

		const transition: Transition = {
			component: result.component,
			from: state.confirmed,
			to: result.status,
			since: state.streakStart ?? result.checkedAt,
			errorCode: result.errorCode,
		};

		state.confirmed = result.status;
		this.resetStreak(state);

		return transition;
	}

	private resetStreak(state: ComponentState): void {
		state.direction = null;
		state.streak = 0;
		state.streakStart = null;
	}
}
