import { describe, expect, it, vi } from "vitest";
import { createResendEmail } from "./resendEmail.js";

const API_KEY = "re_test_secret_key_value";
const FROM = "Nostos Alerts <alerts@example.com>";

interface CapturedRequest {
	url: string;
	init: RequestInit;
}

function fakeFetch(respond: () => Response | Promise<Response>): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
	const requests: CapturedRequest[] = [];
	const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		requests.push({ url: String(url), init: init ?? {} });

		return respond();
	}) as unknown as typeof fetch;

	return { fetchImpl, requests };
}

const message = {
	to: ["admin@example.com"],
	subject: "[Nostos] DOWN: Storage",
	text: "Storage is down.",
};

describe("createResendEmail", () => {
	it("is not configured without an API key or sender, and never calls out", async () => {
		const { fetchImpl, requests } = fakeFetch(() => new Response("{}"));

		for (const options of [{ apiKey: undefined, from: FROM }, { apiKey: API_KEY, from: undefined }]) {
			const transport = createResendEmail({ ...options, fetchImpl });

			expect(transport.isConfigured()).toBe(false);
			await expect(transport.send(message)).resolves.toEqual({ ok: false, errorCode: "not_configured" });
		}

		expect(requests).toEqual([]);
	});

	it("posts the message to the Resend API with bearer auth", async () => {
		const { fetchImpl, requests } = fakeFetch(() => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
		const transport = createResendEmail({ apiKey: API_KEY, from: FROM, fetchImpl });

		await expect(transport.send({ ...message, html: "<p>Storage is down.</p>" })).resolves.toEqual({ ok: true });

		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://api.resend.com/emails");
		expect(requests[0].init.method).toBe("POST");
		expect((requests[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`);
		expect(JSON.parse(requests[0].init.body as string)).toEqual({
			from: FROM,
			to: ["admin@example.com"],
			subject: "[Nostos] DOWN: Storage",
			text: "Storage is down.",
			html: "<p>Storage is down.</p>",
		});
	});

	it("refuses to send without recipients", async () => {
		const { fetchImpl, requests } = fakeFetch(() => new Response("{}"));
		const transport = createResendEmail({ apiKey: API_KEY, from: FROM, fetchImpl });

		await expect(transport.send({ ...message, to: [] })).resolves.toEqual({ ok: false, errorCode: "no_recipients" });
		expect(requests).toEqual([]);
	});

	it("splits more than 50 recipients across requests", async () => {
		const { fetchImpl, requests } = fakeFetch(() => new Response("{}", { status: 200 }));
		const transport = createResendEmail({ apiKey: API_KEY, from: FROM, fetchImpl });
		const to = Array.from({ length: 120 }, (_, index) => `admin${index}@example.com`);

		await expect(transport.send({ ...message, to })).resolves.toEqual({ ok: true });

		const batches = requests.map((request) => (JSON.parse(request.init.body as string) as { to: string[] }).to.length);

		expect(batches).toEqual([50, 50, 20]);
	});

	it("maps Resend error bodies to a sanitized code without the raw message", async () => {
		const { fetchImpl } = fakeFetch(() => new Response(
			JSON.stringify({ name: "validation_error", message: `Invalid key ${API_KEY}` }),
			{ status: 422 },
		));
		const transport = createResendEmail({ apiKey: API_KEY, from: FROM, fetchImpl });

		const result = await transport.send(message);

		expect(result).toEqual({ ok: false, errorCode: "resend_validation_error" });
		expect(JSON.stringify(result)).not.toContain(API_KEY);
	});

	it("falls back to the HTTP status for non-JSON error bodies", async () => {
		const { fetchImpl } = fakeFetch(() => new Response("Bad Gateway", { status: 502 }));
		const transport = createResendEmail({ apiKey: API_KEY, from: FROM, fetchImpl });

		await expect(transport.send(message)).resolves.toEqual({ ok: false, errorCode: "http_502" });
	});

	it("reports network failures and timeouts", async () => {
		const network = createResendEmail({
			apiKey: API_KEY,
			from: FROM,
			fetchImpl: (async () => {
				throw new TypeError("fetch failed");
			}) as unknown as typeof fetch,
		});

		await expect(network.send(message)).resolves.toEqual({ ok: false, errorCode: "network" });

		const slow = createResendEmail({
			apiKey: API_KEY,
			from: FROM,
			timeoutMs: 10,
			fetchImpl: ((_url: string, init: RequestInit) => new Promise((_, reject) => {
				init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
			})) as unknown as typeof fetch,
		});

		await expect(slow.send(message)).resolves.toEqual({ ok: false, errorCode: "timeout" });
	});
});
