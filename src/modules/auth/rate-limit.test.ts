import "../../test/env.js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createMockPrisma, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

import { createApp } from "../../app.js";
import { seedUser } from "../../test/helpers.js";

vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance;
let mock: MockPrisma;

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	await seedUser(mock, { email: "admin@nostos.photos", password: "Correct Horse 12", role: "ADMIN" });
});

describe("login rate limit", () => {
	it("allows a burst of attempts then answers 429 with the envelope", async () => {
		const statuses: number[] = [];

		for (let attempt = 0; attempt < 11; attempt += 1) {
			const response = await app.inject({
				method: "POST",
				url: "/v1/auth/login",
				payload: { email: "nobody@nostos.photos", password: "Wrong Password 99" },
			});

			statuses.push(response.statusCode);
		}

		expect(statuses.slice(0, 10)).toEqual(new Array(10).fill(401));

		const limited = await app.inject({
			method: "POST",
			url: "/v1/auth/login",
			payload: { email: "nobody@nostos.photos", password: "Wrong Password 99" },
		});

		expect(limited.statusCode).toBe(429);
		expect(limited.json().error.code).toBe("RATE_LIMIT_EXCEEDED");
	});
});




