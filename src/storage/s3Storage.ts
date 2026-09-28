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

let client: S3Client | null = null;

function getClient(): S3Client | null {
	if (!isConfigured()) {
		return null;
	}

	if (client === null) {
		const storage = config.storage;

		client = new S3Client({
			endpoint: storage.endpoint,
			region: storage.region,
			credentials: {
				accessKeyId: storage.accessKeyId as string,
				secretAccessKey: storage.secretAccessKey as string,
			},
			// Path-style bucket addressing for SeaweedFS and other
			// self-hosted S3 implementations (S3_FORCE_PATH_STYLE).
			forcePathStyle: storage.forcePathStyle,
		});
	}

	return client;
}

export const s3Storage: StoragePort = {
	async presignPut(key: string, options: PresignPutOptions): Promise<string | null> {
		const s3 = getClient();

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
		const s3 = getClient();

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
