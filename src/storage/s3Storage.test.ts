import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageConfig } from "../types/config.js";
import type { StoragePort } from "./types.js";

const storageConfig = vi.hoisted((): StorageConfig => ({
	provider: "s3",
	endpoint: undefined,
	region: undefined,
	bucket: undefined,
	accessKeyId: undefined,
	secretAccessKey: undefined,
	publicEndpoint: undefined,
	forcePathStyle: true,
}));

vi.mock("../config/index.js", () => ({ config: { storage: storageConfig } }));

// Fresh module per test: S3 clients are cached at module level.
async function loadStorage(): Promise<{ s3Storage: StoragePort }> {
	vi.resetModules();

	return import("./s3Storage.js");
}

function configure(overrides: Partial<StorageConfig>): void {
	Object.assign(storageConfig, {
		endpoint: "http://seaweedfs:8333",
		region: "us-east-1",
		bucket: "nostos",
		accessKeyId: "test-access-key",
		secretAccessKey: "test-secret-key",
		publicEndpoint: undefined,
		forcePathStyle: true,
	}, overrides);
}

describe("s3Storage presigning", () => {
	beforeEach(() => {
		configure({});
	});

	it("signs upload URLs against S3_PUBLIC_ENDPOINT when set", async () => {
		configure({ publicEndpoint: "https://storage.example.com" });
		const { s3Storage } = await loadStorage();

		const url = new URL(await s3Storage.presignPut("originals/a.jpg", { contentType: "image/jpeg" }) as string);

		expect(url.origin).toBe("https://storage.example.com");
		expect(url.pathname).toBe("/nostos/originals/a.jpg");
		expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("host");
	});

	it("does not bake a body checksum into presigned upload URLs", async () => {
		const { s3Storage } = await loadStorage();

		const url = new URL(await s3Storage.presignPut("originals/a.jpg", { contentType: "image/jpeg" }) as string);
		const checksumParams = [...url.searchParams.keys()].filter((key) => key.toLowerCase().includes("checksum"));

		expect(checksumParams).toEqual([]);
	});

	it("signs download URLs against S3_PUBLIC_ENDPOINT when set", async () => {
		configure({ publicEndpoint: "https://storage.example.com" });
		const { s3Storage } = await loadStorage();

		const url = new URL(await s3Storage.presignGet("web/a.jpg") as string);

		expect(url.origin).toBe("https://storage.example.com");
		expect(url.pathname).toBe("/nostos/web/a.jpg");
	});

	it("falls back to S3_ENDPOINT when no public endpoint is configured", async () => {
		const { s3Storage } = await loadStorage();

		const url = new URL(await s3Storage.presignGet("web/a.jpg") as string);

		expect(url.origin).toBe("http://seaweedfs:8333");
	});

	it("returns null when storage is not configured", async () => {
		configure({ endpoint: undefined, publicEndpoint: "https://storage.example.com" });
		const { s3Storage } = await loadStorage();

		await expect(s3Storage.presignPut("originals/a.jpg", { contentType: "image/jpeg" })).resolves.toBeNull();
		await expect(s3Storage.presignGet("web/a.jpg")).resolves.toBeNull();
	});
});

type SentCommand = { constructor: { name: string }; input: Record<string, unknown> };
type SendImpl = (command: SentCommand, options?: { abortSignal?: AbortSignal }) => Promise<unknown>;

// Intercepts every S3 request at the client level; no network involved.
async function loadWithSend(impl: SendImpl): Promise<{ s3Storage: StoragePort; sent: SentCommand[] }> {
	const sdk = await import("@aws-sdk/client-s3");
	const sent: SentCommand[] = [];

	vi.spyOn(sdk.S3Client.prototype, "send").mockImplementation(((command: SentCommand, options?: { abortSignal?: AbortSignal }) => {
		sent.push(command);

		return impl(command, options);
	}) as never);

	const { s3Storage } = await loadStorage();

	return { s3Storage, sent };
}

function s3Error(name: string, status: number): Error {
	return Object.assign(new Error(`${name}: internal detail http://seaweedfs:8333`), {
		name,
		$metadata: { httpStatusCode: status },
	});
}

describe("s3Storage health probes", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		configure({});
	});

	it("returns null when storage is not configured", async () => {
		configure({ endpoint: undefined });
		const { s3Storage, sent } = await loadWithSend(async () => ({}));

		await expect(s3Storage.ping(1_000)).resolves.toBeNull();
		await expect(s3Storage.writeRoundTrip(1_000)).resolves.toBeNull();
		expect(sent).toEqual([]);
	});

	it("pings the configured bucket with HeadBucket", async () => {
		const { s3Storage, sent } = await loadWithSend(async () => ({}));

		await expect(s3Storage.ping(1_000)).resolves.toEqual({ ok: true });
		expect(sent.map((command) => command.constructor.name)).toEqual(["HeadBucketCommand"]);
		expect(sent[0].input).toEqual({ Bucket: "nostos" });
	});

	it("maps provider errors to sanitized codes", async () => {
		const { s3Storage } = await loadWithSend(async () => {
			throw s3Error("AccessDenied", 403);
		});

		await expect(s3Storage.ping(1_000)).resolves.toEqual({ ok: false, errorCode: "s3_AccessDenied" });
	});

	it("falls back to the HTTP status when the SDK cannot name the error", async () => {
		const { s3Storage } = await loadWithSend(async () => {
			throw s3Error("Unknown", 403);
		});

		await expect(s3Storage.ping(1_000)).resolves.toEqual({ ok: false, errorCode: "http_403" });
	});

	it("maps network errors to their lowercase system code", async () => {
		const { s3Storage } = await loadWithSend(async () => {
			throw Object.assign(new Error("connect ECONNREFUSED 10.0.0.2:8333"), { code: "ECONNREFUSED" });
		});

		await expect(s3Storage.ping(1_000)).resolves.toEqual({ ok: false, errorCode: "econnrefused" });
	});

	it("reports a timeout when the request outlives the deadline", async () => {
		const { s3Storage } = await loadWithSend((_command, options) => new Promise((_, reject) => {
			options?.abortSignal?.addEventListener("abort", () => {
				reject(Object.assign(new Error("Request aborted"), { name: "AbortError" }));
			});
		}));

		await expect(s3Storage.ping(10)).resolves.toEqual({ ok: false, errorCode: "timeout" });
	});

	it("writes, reads back, and deletes a probe object under the health prefix", async () => {
		let stored: Uint8Array | undefined;
		const { s3Storage, sent } = await loadWithSend(async (command) => {
			if (command.constructor.name === "PutObjectCommand") {
				stored = new Uint8Array(command.input.Body as Buffer);
			}

			if (command.constructor.name === "GetObjectCommand") {
				return { Body: { transformToByteArray: async () => stored } };
			}

			return {};
		});

		await expect(s3Storage.writeRoundTrip(1_000)).resolves.toEqual({ ok: true });
		expect(sent.map((command) => command.constructor.name)).toEqual([
			"PutObjectCommand",
			"GetObjectCommand",
			"DeleteObjectCommand",
		]);

		const keys = new Set(sent.map((command) => command.input.Key));

		expect(keys.size).toBe(1);
		expect(String(sent[0].input.Key)).toMatch(/^_health\/[0-9a-f-]{36}$/);
	});

	it("still deletes the probe object when the content does not match", async () => {
		const { s3Storage, sent } = await loadWithSend(async (command) => {
			if (command.constructor.name === "GetObjectCommand") {
				return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
			}

			return {};
		});

		await expect(s3Storage.writeRoundTrip(1_000)).resolves.toEqual({ ok: false, errorCode: "content_mismatch" });
		expect(sent.at(-1)?.constructor.name).toBe("DeleteObjectCommand");
	});

	it("does not attempt a delete when the write itself fails", async () => {
		const { s3Storage, sent } = await loadWithSend(async () => {
			throw s3Error("InternalError", 500);
		});

		await expect(s3Storage.writeRoundTrip(1_000)).resolves.toEqual({ ok: false, errorCode: "s3_InternalError" });
		expect(sent.map((command) => command.constructor.name)).toEqual(["PutObjectCommand"]);
	});
});
