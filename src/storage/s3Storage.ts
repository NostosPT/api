import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/index.js";
import type { PresignPutOptions, StoragePort } from "./types.js";

const PUT_URL_TTL_SECONDS = 15 * 60;
const GET_URL_TTL_SECONDS = 5 * 60;

function isConfigured(): boolean {
	const storage = config.storage;

	return Boolean(storage.endpoint && storage.region && storage.bucket && storage.accessKeyId && storage.secretAccessKey);
}

// Narrowed after isConfigured() checks in every method.
function bucket(): string {
	return config.storage.bucket as string;
}

function createClient(endpoint: string): S3Client {
	const storage = config.storage;

	return new S3Client({
		endpoint,
		region: storage.region,
		credentials: {
			accessKeyId: storage.accessKeyId as string,
			secretAccessKey: storage.secretAccessKey as string,
		},
		// Path-style bucket addressing for SeaweedFS and other
		// self-hosted S3 implementations (S3_FORCE_PATH_STYLE).
		forcePathStyle: storage.forcePathStyle,
		// The SDK otherwise bakes a CRC32 of the (empty, at signing time) body
		// into presigned PUT URLs, so every real upload fails with BadDigest.
		requestChecksumCalculation: "WHEN_REQUIRED",
	});
}

let client: S3Client | null = null;
let presignClient: S3Client | null = null;

// Server-side operations (head, ranged reads, hashing) use S3_ENDPOINT.
function getClient(): S3Client | null {
	if (!isConfigured()) {
		return null;
	}

	client ??= createClient(config.storage.endpoint as string);

	return client;
}

// Presigned URLs embed the host they were signed for, so they are signed
// against the browser-reachable S3_PUBLIC_ENDPOINT when the API reaches
// storage over an internal address (e.g. http://seaweedfs:8333 in Docker).
// Signing is offline: this client never opens a connection.
function getPresignClient(): S3Client | null {
	const publicEndpoint = config.storage.publicEndpoint;

	if (!isConfigured() || publicEndpoint === undefined) {
		return getClient();
	}

	presignClient ??= createClient(publicEndpoint);

	return presignClient;
}

export const s3Storage: StoragePort = {
	async presignPut(key: string, options: PresignPutOptions): Promise<string | null> {
		const s3 = getPresignClient();

		if (s3 === null) {
			return null;
		}

		// Only Content-Type is signed (the client echoes it on PUT). Content-length
		// cannot be signed as a maximum in SigV4, so the size cap is enforced at
		// finalize time by headObject (UPLOAD_MAX_BYTES).
		const command = new PutObjectCommand({
			Bucket: bucket(),
			Key: key,
			ContentType: options.contentType,
		});

		return getSignedUrl(s3, command, { expiresIn: options.expiresInSeconds ?? PUT_URL_TTL_SECONDS });
	},

	async presignGet(key: string, expiresInSeconds?: number): Promise<string | null> {
		const s3 = getPresignClient();

		if (s3 === null) {
			return null;
		}

		const command = new GetObjectCommand({ Bucket: bucket(), Key: key });

		return getSignedUrl(s3, command, { expiresIn: expiresInSeconds ?? GET_URL_TTL_SECONDS });
	},

	async headObject(key: string): Promise<{ size: number } | null> {
		const s3 = getClient();

		if (s3 === null) {
			return null;
		}

		try {
			const result = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));

			return { size: result.ContentLength ?? 0 };
		}
		catch {
			return null;
		}
	},

	async getFirstBytes(key: string, count: number): Promise<Uint8Array | null> {
		const s3 = getClient();

		if (s3 === null) {
			return null;
		}

		try {
			const result = await s3.send(
				new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${count - 1}` }),
			);

			return await result.Body?.transformToByteArray() ?? null;
		}
		catch {
			return null;
		}
	},

	async getObjectSha256(key: string): Promise<string | null> {
		const s3 = getClient();

		if (s3 === null) {
			return null;
		}

		try {
			const result = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }));

			if (!result.Body) {
				return null;
			}

			const hash = createHash("sha256");
			const body = result.Body as unknown as Readable;

			for await (const chunk of body) {
				hash.update(chunk as Buffer | string);
			}

			return hash.digest("hex");
		}
		catch {
			return null;
		}
	},
};
