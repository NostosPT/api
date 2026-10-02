import { createHash, randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/index.js";
import { HEALTH_PROBE_PREFIX, healthProbeKey } from "./keys.js";
import type { PresignPutOptions, StoragePort, StorageProbeResult } from "./types.js";

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

const PROBE_BODY_BYTES = 16;
const ORPHAN_SWEEP_LIMIT = 100;

// Maps SDK/network failures to a short code that is safe to store and show
// to admins: no hostnames, keys, or provider messages.
export function storageErrorCode(error: unknown): string {
	if (typeof error !== "object" || error === null) {
		return "error";
	}

	const { name, code, $metadata } = error as {
		name?: unknown;
		code?: unknown;
		$metadata?: { httpStatusCode?: unknown };
	};

	if (name === "AbortError" || name === "TimeoutError") {
		return "timeout";
	}

	if (typeof code === "string" && /^E[A-Z]+$/.test(code)) {
		return code.toLowerCase();
	}

	if (typeof name === "string" && $metadata?.httpStatusCode !== undefined) {
		const safeName = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 48);

		// HEAD responses carry no error body, so the SDK may only know the
		// status (name "Unknown"): the status is the more useful code then.
		return safeName && safeName !== "Unknown" ? `s3_${safeName}` : `http_${String($metadata.httpStatusCode)}`;
	}

	return "error";
}

async function probe(run: (s3: S3Client, signal: AbortSignal) => Promise<StorageProbeResult>, timeoutMs: number): Promise<StorageProbeResult | null> {
	const s3 = getClient();

	if (s3 === null) {
		return null;
	}

	try {
		return await run(s3, AbortSignal.timeout(timeoutMs));
	}
	catch (error) {
		return { ok: false, errorCode: storageErrorCode(error) };
	}
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

	async ping(timeoutMs: number): Promise<StorageProbeResult | null> {
		return probe(async (s3, abortSignal) => {
			await s3.send(new HeadBucketCommand({ Bucket: bucket() }), { abortSignal });

			return { ok: true };
		}, timeoutMs);
	},

	async writeRoundTrip(timeoutMs: number): Promise<StorageProbeResult | null> {
		return probe(async (s3, abortSignal) => {
			const key = healthProbeKey();
			const body = randomBytes(PROBE_BODY_BYTES);

			await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body }), { abortSignal });

			// The object exists from here on: always try to remove it, even
			// when the read fails or timed out (own signal), so probes never
			// accumulate in the bucket.
			try {
				const result = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: key }), { abortSignal });
				const read = await result.Body?.transformToByteArray();

				if (read === undefined || !body.equals(read)) {
					return { ok: false, errorCode: "content_mismatch" };
				}
			}
			finally {
				await s3.send(
					new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
					{ abortSignal: AbortSignal.timeout(timeoutMs) },
				);
			}

			await sweepOrphanedProbes(s3, timeoutMs);

			return { ok: true };
		}, timeoutMs);
	},
};

// A round-trip that times out mid-way can still complete server-side after
// we gave up (e.g. a stalled PUT), leaving its object behind. Each healthy
// round-trip removes such leftovers. Probes never overlap (one scheduler,
// one replica), so everything under the prefix is stale here. Best effort.
async function sweepOrphanedProbes(s3: S3Client, timeoutMs: number): Promise<void> {
	try {
		const listed = await s3.send(
			new ListObjectsV2Command({ Bucket: bucket(), Prefix: `${HEALTH_PROBE_PREFIX}/`, MaxKeys: ORPHAN_SWEEP_LIMIT }),
			{ abortSignal: AbortSignal.timeout(timeoutMs) },
		);

		for (const object of listed.Contents ?? []) {
			if (object.Key?.startsWith(`${HEALTH_PROBE_PREFIX}/`)) {
				await s3.send(
					new DeleteObjectCommand({ Bucket: bucket(), Key: object.Key }),
					{ abortSignal: AbortSignal.timeout(timeoutMs) },
				);
			}
		}
	}
	catch {
		// Leftovers are retried by the next healthy round-trip.
	}
}
