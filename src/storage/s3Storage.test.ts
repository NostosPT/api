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
