import "../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type * as LoggerModule from "../logging/logger.js";

const logged = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("../logging/logger.js", async (importOriginal) => ({
	...await importOriginal<typeof LoggerModule>(),
	error: logged.error,
}));

import { ValidationError } from "../errors/appError.js";
import { registerErrorHandler } from "./errorHandler.js";

let app: FastifyInstance;

class FakePrismaError extends Error {
	code = "P2028";
	meta = { reason: "Transaction already closed" };
}

beforeAll(async () => {
	app = Fastify();
	await registerErrorHandler(app);

	app.get("/boom", () => {
		throw new FakePrismaError("Transaction API error: Transaction already closed");
	});
	app.get("/invalid", () => {
		throw new ValidationError("Bad input");
	});

	await app.ready();
});

beforeEach(() => {
	logged.error.mockClear();
});

describe("error handler logging", () => {
	it("logs the original error for 5xx without exposing it in the response", async () => {
		const response = await app.inject({ method: "GET", url: "/boom" });
		const body = response.json();

		expect(response.statusCode).toBe(500);
		expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
		expect(body.error.message).toBe("Internal server error");
		expect(response.body).not.toContain("Transaction already closed");
		expect(response.body).not.toContain("P2028");
		expect(response.body).not.toContain("at ");

		expect(logged.error).toHaveBeenCalledTimes(1);

		const [message, data] = logged.error.mock.calls[0] as [string, { err: unknown; requestId: string }];

		expect(message).toContain("status 500");
		expect(data.err).toBeInstanceOf(FakePrismaError);
		expect((data.err as FakePrismaError).code).toBe("P2028");
		expect(data.requestId).toBe(body.error.requestId);
	});

	it("keeps 4xx logging to the summary line", async () => {
		const response = await app.inject({ method: "GET", url: "/invalid" });

		expect(response.statusCode).toBe(400);
		expect(logged.error).toHaveBeenCalledTimes(1);
		expect(logged.error.mock.calls[0]).toHaveLength(1);
	});
});
