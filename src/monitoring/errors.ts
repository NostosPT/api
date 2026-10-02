function toSnakeCase(value: string): string {
	return value
		.replace(/[^A-Za-z0-9]/g, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.slice(0, 48);
}

// Maps thrown errors to a short code that is safe to store and email:
// timeouts, Node system/TLS codes (also behind fetch's `cause`), Prisma
// driver-adapter kinds, Prisma codes. Hosts, ports, users, and messages are
// deliberately dropped.
export function errorCodeOf(error: unknown): string {
	if (typeof error !== "object" || error === null) {
		return "error";
	}

	const { name, code, meta, cause } = error as {
		name?: unknown;
		code?: unknown;
		meta?: { driverAdapterError?: { cause?: { kind?: unknown } } };
		cause?: unknown;
	};

	if (name === "TimeoutError" || name === "AbortError") {
		return "timeout";
	}

	// fetch() rejects with TypeError("fetch failed") and the real reason in
	// `cause` (ENOTFOUND, ECONNREFUSED, CERT_HAS_EXPIRED, ...).
	if (code === undefined && typeof cause === "object" && cause !== null) {
		return errorCodeOf(cause);
	}

	const adapterKind = meta?.driverAdapterError?.cause?.kind;

	if (typeof adapterKind === "string" && toSnakeCase(adapterKind)) {
		return toSnakeCase(adapterKind);
	}

	if (typeof code === "string" && /^P\d{4}$/.test(code)) {
		return `prisma_${code}`;
	}

	if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,47}$/.test(code)) {
		return code.toLowerCase();
	}

	return "error";
}
