import "./test/env.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { StorageProbeResult } from "./storage/index.js";

const state = vi.hoisted(() => ({
	databaseUp: true,
	storage: { ok: true } as StorageProbeResult | null,
}));

vi.mock("./db/prisma.js", () => ({
	prisma: {
		$queryRaw: async () => {
			if (!state.databaseUp) {
				throw new Error("connect ECONNREFUSED postgres:5432");
			}

			return [{ "?column?": 1 }];
		},
	},
	disconnectPrisma: async () => undefined,
}));

vi.mock("./storage/index.js", () => ({
	storage: {
		ping: async () => state.storage,
	},
}));

let app: FastifyInstance;

beforeAll(async () => {
	const { createApp } = await import("./app.js");

	app = await createApp();
});

afterAll(async () => {
	await app.close();
});

beforeEach(() => {
	state.databaseUp = true;
	state.storage = { ok: true };
});

describe("GET /v1/ready", () => {
	it("is ready when the database and storage answer", async () => {
		const response = await app.inject({ method: "GET", url: "/v1/ready" });

		expect(response.statusCode).toBe(200);
		expect(response.json()).toEqual({ status: "ok" });
	});

	it("stays ready when storage is not configured", async () => {
		state.storage = null;

		const response = await app.inject({ method: "GET", url: "/v1/ready" });

		expect(response.statusCode).toBe(200);
	});

	it("returns 503 without internals when storage is unreachable", async () => {
		state.storage = { ok: false, errorCode: "s3_AccessDenied" };

		const response = await app.inject({ method: "GET", url: "/v1/ready" });
		const body = response.json();

		expect(response.statusCode).toBe(503);
		expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
		expect(body.error.message).toBe("Storage unreachable");
		expect(JSON.stringify(body)).not.toContain("AccessDenied");
	});

	it("reports the database first when both are down", async () => {
		state.databaseUp = false;
		state.storage = { ok: false, errorCode: "timeout" };

		const response = await app.inject({ method: "GET", url: "/v1/ready" });
		const body = response.json();

		expect(response.statusCode).toBe(503);
		expect(body.error.message).toBe("Database unreachable");
		expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
	});
});
