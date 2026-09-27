import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
	app = await createApp();
});

describe("health", () => {
	it("returns liveness status", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/health" });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ status: "ok" });
	});
});

describe("errors", () => {
	it("returns the not-found envelope for unknown routes", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/nope" });
		const body = response.json();

		expect(response.statusCode).toBe(404);
		expect(body.error.code).toBe("NOT_FOUND");
		expect(body.error.statusCode).toBe(404);
		expect(typeof body.error.message).toBe("string");
		expect(typeof body.error.requestId).toBe("string");
	});
});

describe("security headers and CORS", () => {
	it("sets hardening headers", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/health" });

		expect(response.headers["x-content-type-options"]).toBe("nosniff");
		expect(response.headers["x-request-id"]).toBeDefined();
	});

	it("reflects an allowed origin with credentials", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/health",
			headers: { origin: "https://app.example.com" },
		});

		expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
		expect(response.headers["access-control-allow-credentials"]).toBe("true");
	});

	it("does not reflect a disallowed origin", async () => {
		const response = await app.inject({
			method: "GET",
			url: "/v1/health",
			headers: { origin: "https://evil.example.com" },
		});

		expect(response.headers["access-control-allow-origin"]).toBeUndefined();
	});
});