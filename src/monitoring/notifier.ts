import type { EmailMessage, EmailPort } from "../email/index.js";
import * as logger from "../logging/logger.js";
import type { Transition } from "./stateTracker.js";
import type { HealthComponent } from "./types.js";

export const COMPONENT_LABELS: Record<HealthComponent, string> = {
	DATABASE: "Database",
	STORAGE: "Storage",
	STORAGE_WRITE: "Storage writes",
	PUBLIC_API: "Public API",
	PUBLIC_API_TLS: "Public API TLS certificate",
	PUBLIC_STORAGE: "Public storage",
	PUBLIC_STORAGE_TLS: "Public storage TLS certificate",
	BACKUP: "Off-site backup",
};

export interface RecipientSource {
	get(): Promise<string[]>;
}

function formatUtc(date: Date): string {
	return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

// Plain text only: every value is a fixed label, a status, a timestamp, or a
// sanitized code, so nothing needs escaping.
export function buildAlertMessage(transition: Transition, to: string[]): EmailMessage {
	const label = COMPONENT_LABELS[transition.component];
	const headline = transition.to === "UP" ? "RECOVERED" : transition.to;
	const lines = [
		transition.to === "UP" ? `${label} has recovered and is UP.` : `${label} is ${transition.to}.`,
		"",
		`Previous state: ${transition.from ?? "unknown (monitor started)"}`,
		`Since: ${formatUtc(transition.since)}`,
	];

	if (transition.errorCode !== null) {
		lines.push(`Reason: ${transition.errorCode}`);
	}

	lines.push(
		"",
		"Details and uptime: GET /v1/system/status (ADMIN).",
		"You get one email per confirmed state change.",
	);

	return {
		to,
		subject: `[Nostos] ${headline}: ${label}`,
		text: lines.join("\n"),
	};
}

// Turns confirmed state changes into alert emails for the ADMIN list.
// Never throws: alerting must not break the monitoring loop.
export class AlertNotifier {
	constructor(
		private readonly email: EmailPort,
		private readonly recipients: RecipientSource,
	) {}

	async notify(transition: Transition): Promise<void> {
		const context = { component: transition.component, from: transition.from, to: transition.to };

		// A healthy start is not news.
		if (transition.from === null && transition.to === "UP") {
			return;
		}

		logger.warn("Health state changed", { ...context, errorCode: transition.errorCode });

		if (!this.email.isConfigured()) {
			return;
		}

		try {
			const to = await this.recipients.get();

			if (to.length === 0) {
				logger.error("Alert not sent: no ADMIN or fallback recipients", context);

				return;
			}

			const result = await this.email.send(buildAlertMessage(transition, to));

			if (!result.ok) {
				logger.error("Alert email failed", { ...context, errorCode: result.errorCode });
			}
		}
		catch {
			logger.error("Alert email failed", { ...context, errorCode: "unexpected" });
		}
	}
}
