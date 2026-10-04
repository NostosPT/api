// Generates the upload payloads used by the staff "uploader" journey: files of
// 10-49 MB that start with a JPEG signature (the API checks magic bytes, then
// SHA-256s the whole object on finalize). Random content, so nothing compresses
// along the way. Writes loadtest/.data/uploads/*.jpg plus manifest.json.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(DIR, "../.data/uploads");
const MB = 1024 * 1024;

// UPLOAD_MAX_BYTES defaults to 50 MB, so the largest file stays just below it.
const SIZES_MB = (process.env.LT_UPLOAD_SIZES_MB ?? "10,20,35,49").split(",").map(Number);

await mkdir(OUT, { recursive: true });

const manifest: { file: string; bytes: number; sha256: string }[] = [];

for (const sizeMb of SIZES_MB) {
	const bytes = Math.round(sizeMb * MB);
	const buffer = randomBytes(bytes);
	// JPEG SOI + APP0 marker; the rest is opaque payload.
	buffer.set([0xFF, 0xD8, 0xFF, 0xE0], 0);
	const file = `upload-${sizeMb}mb.jpg`;
	await writeFile(path.join(OUT, file), buffer);
	manifest.push({ file, bytes, sha256: createHash("sha256").update(buffer).digest("hex") });
	console.log(`[uploads] ${file} ${sizeMb} MB`);
}

await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
