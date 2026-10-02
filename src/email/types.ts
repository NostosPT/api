export interface EmailMessage {
	to: string[];
	subject: string;
	text: string;
	html?: string;
}

// `errorCode` is short and sanitized (timeout, http_429, resend_validation_error)
// and never contains the API key or the provider's raw response.
export type EmailSendResult =
	| { ok: true }
	| { ok: false; errorCode: string };

// Email port: one outbound transport behind an interface so Phase 2 mail
// (DECISIONS.md) can reuse or replace it without touching callers.
export interface EmailPort {
	// False until the transport has credentials and a sender.
	isConfigured(): boolean;
	send(message: EmailMessage): Promise<EmailSendResult>;
}
