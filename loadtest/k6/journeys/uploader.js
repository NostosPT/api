// Staff member uploading originals: presigned upload intent, direct PUT of a
// 10-49 MB file to storage (bypasses the API, as in the browser), then
// finalize. Finalize HEADs the object, reads its magic bytes and streams the
// whole object through SHA-256, so its cost grows with file size.
//
// Files are opened through k6/experimental/fs, which keeps one copy in memory
// for all VUs instead of one per VU.
import * as fs from "k6/experimental/fs";
import http from "k6/http";
import { check, sleep } from "k6";
import { api, json } from "../lib/http.js";
import { fx } from "../lib/fixtures.js";
import { int, pick, uid } from "../lib/random.js";
import { staffSession } from "./staff.js";

const UPLOADS_DIR = __ENV.LT_UPLOADS_DIR;
// Plain open() for the small manifest; the payloads go through the fs module.
const manifest = UPLOADS_DIR ? JSON.parse(open(`${UPLOADS_DIR}/manifest.json`)) : [];
const files = [];

if (UPLOADS_DIR) {
	(async () => {
		for (const entry of manifest) {
			files.push({ ...entry, handle: await fs.open(`${UPLOADS_DIR}/${entry.file}`) });
		}
	})();
}

const THINK_MIN = Number(__ENV.LT_UPLOAD_THINK_MIN ?? 30);
const THINK_MAX = Number(__ENV.LT_UPLOAD_THINK_MAX ?? 90);

async function readAll(file) {
	const buffer = new Uint8Array(file.bytes);
	let offset = 0;

	await file.handle.seek(0, fs.SeekMode.Start);

	while (offset < file.bytes) {
		const chunk = new Uint8Array(buffer.buffer, offset);
		const read = await file.handle.read(chunk);

		if (read === null || read === 0) {
			break;
		}

		offset += read;
	}

	return buffer.buffer;
}

/** Uploads one file and returns the registered photo, or null. */
export async function uploadPhoto(s, kind = "upload", file = pick(files)) {
	const o = { ip: s.ip, session: s.token, kind };
	const intent = json(api("POST", "/photos/uploads", "/photos/uploads", { ...o, body: { contentType: "image/jpeg", filename: `IMG_${int(1000, 9999)}.jpg` } }));

	if (!intent?.uploadUrl) {
		return null;
	}

	const body = await readAll(file);
	const put = http.put(intent.uploadUrl, body, {
		headers: { "content-type": "image/jpeg" },
		tags: { name: "PUT storage (presigned upload)", kind },
		timeout: "180s",
	});
	check(put, { "PUT storage (presigned upload) ok": (r) => r.status === 200 }, { kind });

	if (put.status !== 200) {
		return null;
	}

	return json(api("POST", "/photos", "/photos", {
		...o,
		body: {
			originalKey: intent.key,
			sha256: file.sha256,
			title: `Upload ${uid()}`,
			width: 8256,
			height: 5504,
			takenAt: new Date().toISOString(),
			location: "Lisboa",
			visibility: "PRIVATE",
			availability: "AVAILABLE",
			priceCents: 4500,
		},
	}));
}

export async function uploaderIteration() {
	const s = staffSession("upload");

	if (s === null || files.length === 0) {
		sleep(5);
		return;
	}

	const photo = await uploadPhoto(s);

	if (photo?.id) {
		const o = { ip: s.ip, session: s.token, kind: "upload" };
		sleep(1);
		api("PATCH", "/photos/:id", `/photos/${photo.id}`, { ...o, body: { description: "Fresh from the camera." } });
		api("POST", "/photos/:id/categories/:categoryId", `/photos/${photo.id}/categories/${pick(fx.categoryIds)}`, { ...o, ok: [200, 201, 204, 409] });
		api("POST", "/photos/:id/tags/:tagId", `/photos/${photo.id}/tags/${pick(fx.tagIds)}`, { ...o, ok: [200, 201, 204, 409] });
		// DRAFT -> APPROVED -> PUBLISHED; stays PRIVATE so the public catalogue is unchanged.
		api("POST", "/photos/:id/publish", `/photos/${photo.id}/publish`, o);
		api("POST", "/photos/:id/publish", `/photos/${photo.id}/publish`, o);
	}

	sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

export function uploadFilesAvailable() {
	return manifest.length;
}
