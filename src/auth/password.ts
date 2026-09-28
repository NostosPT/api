import { argon2id, hash, verify } from "argon2";

// Centralized Argon2id configuration for staff credentials. OWASP-aligned
// server defaults: 64 MiB memory, 3 iterations, single lane.
const ARGON_OPTIONS = {
	type: argon2id,
	memoryCost: 2 ** 16,
	timeCost: 3,
	parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
	return hash(password, {
		type: ARGON_OPTIONS.type,
		memoryCost: ARGON_OPTIONS.memoryCost,
		timeCost: ARGON_OPTIONS.timeCost,
		parallelism: ARGON_OPTIONS.parallelism,
	});
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
	try {
		return await verify(hashValue, password);
	}
	catch {
		return false;
	}
}
