import { config } from "../config/index.js";
import { createResendEmail } from "./resendEmail.js";
import type { EmailPort } from "./types.js";

export const email: EmailPort = createResendEmail({
	apiKey: config.alerts.resendApiKey,
	from: config.alerts.from,
});
export type { EmailMessage, EmailPort, EmailSendResult } from "./types.js";
