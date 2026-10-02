export interface PresignPutOptions {
	contentType: string;
	expiresInSeconds?: number;
}

// Outcome of a health probe. `errorCode` is short and sanitized (timeout,
// s3_AccessDenied, econnrefused) and never carries raw provider messages.
export type StorageProbeResult =
	| { ok: true }
	| { ok: false; errorCode: string };

// Storage port (DECISIONS.md): SeaweedFS behind an S3-compatible interface so
// the implementation can be swapped without touching the photo domain.
// presign* resolve to null when storage is not configured (dev without S3),
// letting DTOs degrade to null URLs instead of failing reads.
export interface StoragePort {
	presignPut(key: string, options: PresignPutOptions): Promise<string | null>;
	presignGet(key: string, expiresInSeconds?: number): Promise<string | null>;
	// Null when the object does not exist or storage is unreachable.
	headObject(key: string): Promise<{ size: number } | null>;
	getFirstBytes(key: string, count: number): Promise<Uint8Array | null>;
	// Null when storage is unreachable; used only when the client supplied a hash.
	getObjectSha256(key: string): Promise<string | null>;
	// Health probes resolve to null when storage is not configured.
	// ping: bucket reachable with our credentials (read-only).
	ping(timeoutMs: number): Promise<StorageProbeResult | null>;
	// writeRoundTrip: put, read back, and delete a tiny object under the
	// reserved health prefix, proving the volume accepts writes.
	writeRoundTrip(timeoutMs: number): Promise<StorageProbeResult | null>;
}
