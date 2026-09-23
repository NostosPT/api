import { presignDownload } from "./s3.js";

type PhotoKeys = { originalKey: string; displayKey: string | null; thumbnailKey: string | null };

type Options = {
  /** Expose a URL to the full-resolution original (staff, or galleries with downloads enabled). */
  original: boolean;
  /** Show the original when no display rendition exists yet. Never on the public archive. */
  fallbackToOriginal: boolean;
};

/** Resolves short-lived presigned URLs for a photo's renditions. */
export async function photoUrls(photo: PhotoKeys, opts: Options) {
  const displayKey = photo.displayKey ?? (opts.fallbackToOriginal ? photo.originalKey : null);
  const thumbnailKey = photo.thumbnailKey ?? displayKey;

  const [display, thumbnail, original] = await Promise.all([
    displayKey ? presignDownload(displayKey) : null,
    thumbnailKey ? presignDownload(thumbnailKey) : null,
    opts.original ? presignDownload(photo.originalKey) : null,
  ]);
  return { display, thumbnail, original };
}
