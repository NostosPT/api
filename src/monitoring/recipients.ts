import * as logger from "../logging/logger.js";

export const RECIPIENT_REFRESH_MS = 10 * 60 * 1000;

// Alert recipients = ACTIVE ADMIN users. The list is cached so alerts can
// still be addressed while PostgreSQL is down (exactly when they matter).
// The fallback list is used only when nothing usable has been cached: the
// process started during an outage, or there is no active ADMIN.
// refresh() must also run on a timer, so the cache is warm before an outage.
export class RecipientCache {
	private cached: string[] | null = null;
	private lastAttempt = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly load: () => Promise<string[]>,
		private readonly fallback: string[],
		private readonly refreshMs: number = RECIPIENT_REFRESH_MS,
		private readonly now: () => number = Date.now,
	) {}

	async refresh(): Promise<void> {
		this.lastAttempt = this.now();

		try {
			const emails = await this.load();

			this.cached = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
		}
		catch {
			// Keep the last known list; the caller decides what to do without one.
			logger.warn("Alert recipient refresh failed; using the cached list");
		}
	}

	async get(): Promise<string[]> {
		if (this.now() - this.lastAttempt >= this.refreshMs) {
			await this.refresh();
		}

		if (this.cached !== null && this.cached.length > 0) {
			return this.cached;
		}

		return this.fallback;
	}
}
