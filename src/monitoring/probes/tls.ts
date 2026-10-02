import { connect } from "node:tls";
import { errorCodeOf } from "../errors.js";
import { measure } from "../timing.js";
import type { Clock, HealthStatus, Probe } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CertificateInfo {
	// Chain and hostname verified against the system trust store.
	authorized: boolean;
	// Node's verification code (e.g. CERT_HAS_EXPIRED) when not authorized.
	authorizationError: string | null;
	validTo: Date;
}

export type InspectCertificate = (host: string, port: number, timeoutMs: number) => Promise<CertificateInfo>;

// Completes a TLS handshake (no HTTP request) and reads the leaf certificate.
export const inspectCertificate: InspectCertificate = (host, port, timeoutMs) => new Promise((resolve, reject) => {
	const socket = connect({
		host,
		port,
		servername: host,
		// Verification failures are reported through `authorized` instead of
		// aborting, so an expired certificate still yields its expiry date.
		rejectUnauthorized: false,
	});

	socket.setTimeout(timeoutMs, () => {
		socket.destroy(Object.assign(new Error("TLS handshake timed out"), { name: "TimeoutError" }));
	});

	// `on`, not `once`: a late socket error after settling must still have a
	// listener, or it would crash the process. Extra rejects are no-ops.
	socket.on("error", reject);

	socket.once("secureConnect", () => {
		const certificate = socket.getPeerCertificate();
		const authorizationError = socket.authorizationError;

		socket.end();

		if (!certificate.valid_to) {
			reject(Object.assign(new Error("No peer certificate"), { code: "NO_PEER_CERTIFICATE" }));

			return;
		}

		resolve({
			authorized: socket.authorized,
			authorizationError: authorizationError ? String(authorizationError) : null,
			validTo: new Date(certificate.valid_to),
		});
	});
});

export interface TlsProbeOptions {
	component: "PUBLIC_API_TLS" | "PUBLIC_STORAGE_TLS";
	url: string;
	timeoutMs: number;
	degradedDays: number;
	downDays: number;
	inspect?: InspectCertificate;
	clock?: Clock;
}

function classifyExpiry(daysLeft: number, options: TlsProbeOptions): HealthStatus {
	if (daysLeft < options.downDays) {
		return "DOWN";
	}

	return daysLeft < options.degradedDays ? "DEGRADED" : "UP";
}

// Resolves to null for plain-http URLs: there is no certificate to watch.
export function createTlsProbe(options: TlsProbeOptions): Probe {
	const clock = options.clock ?? (() => new Date());
	const inspect = options.inspect ?? inspectCertificate;
	const url = new URL(options.url);

	return async () => {
		if (url.protocol !== "https:") {
			return null;
		}

		const checkedAt = clock();

		try {
			const port = url.port ? Number(url.port) : 443;
			const { value: certificate, latencyMs } = await measure(() => inspect(url.hostname, port, options.timeoutMs));

			if (!certificate.authorized) {
				const reason = certificate.authorizationError ?? "UNAUTHORIZED";

				return {
					component: options.component,
					status: "DOWN",
					latencyMs,
					errorCode: errorCodeOf({ code: reason }),
					checkedAt,
				};
			}

			const daysLeft = Math.floor((certificate.validTo.getTime() - checkedAt.getTime()) / DAY_MS);
			const status = classifyExpiry(daysLeft, options);

			return {
				component: options.component,
				status,
				latencyMs,
				errorCode: status === "UP" ? null : `expires_in_${Math.max(daysLeft, 0)}d`,
				checkedAt,
			};
		}
		catch (error) {
			return { component: options.component, status: "DOWN", latencyMs: null, errorCode: errorCodeOf(error), checkedAt };
		}
	};
}
