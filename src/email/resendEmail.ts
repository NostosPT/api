import type { EmailMessage, EmailPort, EmailSendResult } from "./types.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Resend rejects more than 50 recipients per message.
const MAX_RECIPIENTS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ResendOptions {
	apiKey: string | undefined;
	from: string | undefined;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];

	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}

	return chunks;
}

// Resend error bodies look like { name: "validation_error", message: "..." };
// only the name is kept, reduced to a safe identifier.
async function errorCodeFromResponse(response: Response): Promise<string> {
	try {
		const body = await response.json() as { name?: unknown };

		if (typeof body.name === "string") {
			const safeName = body.name.replace(/[^a-z0-9_]/gi, "").slice(0, 48);

			if (safeName) {
				return `resend_${safeName}`;
			}
		}
	}
	catch {
		// Non-JSON body: the status is all we report.
	}

	return `http_${response.status}`;
}

function errorCodeFromThrown(error: unknown): string {
	const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;

	return name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
}

// Resend over its HTTP API with the built-in fetch (no SDK dependency).
export function createResendEmail(options: ResendOptions): EmailPort {
	const { apiKey, from } = options;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const fetchImpl = options.fetchImpl ?? fetch;

	async function sendOne(message: EmailMessage, to: string[]): Promise<EmailSendResult> {
		try {
			const response = await fetchImpl(RESEND_ENDPOINT, {
				method: "POST",
				headers: {
					"Authorization": `Bearer ${apiKey as string}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					from,
					to,
					subject: message.subject,
					text: message.text,
					...(message.html === undefined ? {} : { html: message.html }),
				}),
				signal: AbortSignal.timeout(timeoutMs),
			});

			if (!response.ok) {
				return { ok: false, errorCode: await errorCodeFromResponse(response) };
			}

			return { ok: true };
		}
		catch (error) {
			return { ok: false, errorCode: errorCodeFromThrown(error) };
		}
	}

	return {
		isConfigured(): boolean {
			return apiKey !== undefined && from !== undefined;
		},

		async send(message: EmailMessage): Promise<EmailSendResult> {
			if (apiKey === undefined || from === undefined) {
				return { ok: false, errorCode: "not_configured" };
			}

			if (message.to.length === 0) {
				return { ok: false, errorCode: "no_recipients" };
			}

			// Every chunk is attempted; the first failure is reported.
			let failure: EmailSendResult | null = null;

			for (const recipients of chunk(message.to, MAX_RECIPIENTS)) {
				const result = await sendOne(message, recipients);

				if (!result.ok && failure === null) {
					failure = result;
				}
			}

			return failure ?? { ok: true };
		},
	};
}
