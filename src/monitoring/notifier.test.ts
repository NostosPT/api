import { describe, expect, it } from "vitest";
import type { EmailMessage, EmailPort, EmailSendResult } from "../email/index.js";
import { AlertNotifier, buildAlertMessage } from "./notifier.js";
import type { Transition } from "./stateTracker.js";

const since = new Date("2026-10-02T12:01:30.000Z");

function transition(overrides: Partial<Transition> = {}): Transition {
	return { component: "STORAGE", from: "UP", to: "DOWN", since, errorCode: "timeout", ...overrides };
}

function fakeEmail(configured = true, result: EmailSendResult = { ok: true }): EmailPort & { sent: EmailMessage[] } {
	const sent: EmailMessage[] = [];

	return {
		sent,
		isConfigured: () => configured,
		send: async (message) => {
			sent.push(message);

			return result;
		},
	};
}

const admins = { get: async () => ["admin@example.com"] };

describe("buildAlertMessage", () => {
	it("describes an outage", () => {
		const message = buildAlertMessage(transition(), ["admin@example.com"]);

		expect(message.to).toEqual(["admin@example.com"]);
		expect(message.subject).toBe("[Nostos] DOWN: Storage");
		expect(message.text).toContain("Storage is DOWN.");
		expect(message.text).toContain("Previous state: UP");
		expect(message.text).toContain("Since: 2026-10-02 12:01:30 UTC");
		expect(message.text).toContain("Reason: timeout");
	});

	it("describes a recovery without a reason", () => {
		const message = buildAlertMessage(transition({ from: "DOWN", to: "UP", errorCode: null }), ["admin@example.com"]);

		expect(message.subject).toBe("[Nostos] RECOVERED: Storage");
		expect(message.text).toContain("Storage has recovered and is UP.");
		expect(message.text).not.toContain("Reason:");
	});

	it("labels degradation and an unknown previous state", () => {
		const message = buildAlertMessage(
			transition({ component: "PUBLIC_API_TLS", from: null, to: "DEGRADED", errorCode: "expires_in_10d" }),
			["admin@example.com"],
		);

		expect(message.subject).toBe("[Nostos] DEGRADED: Public API TLS certificate");
		expect(message.text).toContain("Previous state: unknown (monitor started)");
	});
});

describe("AlertNotifier", () => {
	it("emails the admins on a state change", async () => {
		const email = fakeEmail();

		await new AlertNotifier(email, admins).notify(transition());

		expect(email.sent).toHaveLength(1);
		expect(email.sent[0].to).toEqual(["admin@example.com"]);
	});

	it("stays quiet on a healthy start", async () => {
		const email = fakeEmail();

		await new AlertNotifier(email, admins).notify(transition({ from: null, to: "UP", errorCode: null }));

		expect(email.sent).toEqual([]);
	});

	it("alerts when the monitor starts during an outage", async () => {
		const email = fakeEmail();

		await new AlertNotifier(email, admins).notify(transition({ from: null, to: "DOWN" }));

		expect(email.sent).toHaveLength(1);
	});

	it("does not send or load recipients when email is not configured", async () => {
		const email = fakeEmail(false);
		let loads = 0;

		await new AlertNotifier(email, {
			get: async () => {
				loads += 1;

				return ["admin@example.com"];
			},
		}).notify(transition());

		expect(email.sent).toEqual([]);
		expect(loads).toBe(0);
	});

	it("does not send without recipients", async () => {
		const email = fakeEmail();

		await new AlertNotifier(email, { get: async () => [] }).notify(transition());

		expect(email.sent).toEqual([]);
	});

	it("never throws when sending or recipient lookup fails", async () => {
		const failing = fakeEmail(true, { ok: false, errorCode: "http_500" });

		await expect(new AlertNotifier(failing, admins).notify(transition())).resolves.toBeUndefined();
		await expect(new AlertNotifier(fakeEmail(), {
			get: async () => {
				throw new Error("boom");
			},
		}).notify(transition())).resolves.toBeUndefined();
	});
});
