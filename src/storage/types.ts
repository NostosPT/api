export interface PresignPutOptions {
	contentType: string;
	expiresInSeconds?: number;
}

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
}
