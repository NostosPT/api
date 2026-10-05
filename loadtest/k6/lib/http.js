// Thin HTTP layer shared by every journey.
//
// - Every request carries a route-template `name` tag (e.g. "GET /v1/photos/:id"),
//   so results group per endpoint instead of per concrete URL.
// - X-Forwarded-For identifies the simulated user. The API trusts it
//   (TRUST_PROXY=true, as behind Caddy in production), so each user gets its
//   own rate-limit bucket.
// - The session cookie is sent explicitly: the API issues a `__Host-` Secure
//   cookie that k6's cookie jar would refuse to send over plain HTTP.
import { check } from "k6";
import http from "k6/http";

export const BASE = `${__ENV.LT_BASE_URL ?? "http://127.0.0.1:3100"}/v1`;

const DEFAULT_OK = http.expectedStatuses({ min: 200, max: 399 });
const DEBUG = __ENV.LT_DEBUG === "1";

// Stable IPv4 from an integer: 10.x.y.z, never .0.
export function ipFor(n) {
	const v = (n % 16_000_000) + 1;
	return `10.${(v >> 16) & 255}.${(v >> 8) & 255}.${v & 255 || 1}`;
}

/**
 * @param {string} method
 * @param {string} name  route template, e.g. "/photos/:id" (without /v1)
 * @param {string} path  concrete path, e.g. "/photos/1234-..."
 * @param {object} [opts]
 * @param {unknown} [opts.body]     JSON body
 * @param {string} [opts.ip]        X-Forwarded-For value
 * @param {string} [opts.session]   session token
 * @param {number[]} [opts.ok]      statuses that count as success (default 2xx/3xx)
 * @param {string} [opts.kind]      public | staff | upload | coverage
 * @param {object} [opts.tags]      extra metric tags (step, phase)
 */
export function api(method, name, path, opts = {}) {
	const headers = { "x-forwarded-for": opts.ip ?? "10.0.0.1" };

	if (opts.body !== undefined) {
		headers["content-type"] = "application/json";
	}

	if (opts.session) {
		headers.cookie = `__Host-nostos.sid=${opts.session}`;
	}

	const tags = { name: `${method} /v1${name}`, kind: opts.kind ?? "public" };

	if (opts.tags) {
		Object.assign(tags, opts.tags);
	}

	const res = http.request(method, `${BASE}${path}`, opts.body === undefined ? null : JSON.stringify(opts.body), {
		headers,
		tags,
		// Fresh jar per request: sessions travel only via the explicit cookie header.
		jar: new http.CookieJar(),
		responseCallback: opts.ok ? http.expectedStatuses(...opts.ok) : DEFAULT_OK,
		timeout: "30s",
	});

	const okStatuses = opts.ok ?? null;
	const passed = check(res, {
		[`${tags.name} ok`]: (r) => (okStatuses ? okStatuses.includes(r.status) : r.status >= 200 && r.status < 400),
	}, { kind: tags.kind });

	if (!passed && DEBUG) {
		console.warn(`${method} ${path} -> ${res.status} ${String(res.body).slice(0, 300)}`);
	}

	return res;
}

export function json(res) {
	try {
		return res.json();
	}
	catch {
		return null;
	}
}

export function login(email, password, ip, kind = "staff") {
	const res = api("POST", "/auth/login", "/auth/login", { body: { email, password }, ip, kind });
	const cookie = res.cookies["__Host-nostos.sid"];

	return cookie && cookie.length > 0 ? cookie[0].value : null;
}
