function toSnakeCase(value: string): string {
	return value
		.replace(/[^A-Za-z0-9]/g, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.slice(0, 48);
}

// Maps thrown errors to a short code that is safe to store and email:
// timeouts, Node system codes, Prisma driver-adapter kinds, Prisma codes.
// Hosts, ports, users, and messages are deliberately dropped.
export function errorCodeOf(error: unknown): string {
	if (typeof error !== "object" || error === null) {
		return "error";
	}

	const { name, code, meta } = error as {
		name?: unknown;
		code?: unknown;
		meta?: { driverAdapterError?: { cause?: { kind?: unknown } } };
	};

	if (name === "TimeoutError" || name === "AbortError") {
		return "timeout";
	}

	const adapterKind = meta?.driverAdapterError?.cause?.kind;

	if (typeof adapterKind === "string" && toSnakeCase(adapterKind)) {
		return toSnakeCase(adapterKind);
	}

	if (typeof code === "string" && /^E[A-Z]+$/.test(code)) {
		return code.toLowerCase();
	}

	if (typeof code === "string" && /^P\d{4}$/.test(code)) {
		return `prisma_${code}`;
	}

	return "error";
}
