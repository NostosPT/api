import { randomUUID } from "node:crypto";

// Object key layout inside the bucket (S3-compatible, provider-agnostic).
// Only `originals/` is written today (presigned browser uploads); `web/`,
// `thumbnails/` and `watermarks/` are reserved for the future rendition
// pipeline so keys never need to move.
export const PHOTO_KEY_PREFIXES = {
	originals: "originals",
	web: "web",
	thumbnails: "thumbnails",
	watermarks: "watermarks",
} as const;

export type PhotoKeyPrefix = (typeof PHOTO_KEY_PREFIXES)[keyof typeof PHOTO_KEY_PREFIXES];

/**
 * Private original key for a new upload intent. Takes the already-validated
 * slugified filename (or null when the client sent none) and never serves
 * the result publicly — reads go through presigned URLs.
 */
export function originalKey(slugifiedFilename: string | null): string {
	return `${PHOTO_KEY_PREFIXES.originals}/${randomUUID()}${slugifiedFilename === null ? "" : `-${slugifiedFilename}`}`;
}
