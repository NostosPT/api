import "../../test/env.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { createMockPrisma, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

import { createApp } from "../../app.js";
import { auditActions, seedSession, seedUser, sessionCookie } from "../../test/helpers.js";

vi.setConfig({ testTimeout: 30_000 });

let app: FastifyInstance;
let mock: MockPrisma;
let adminCookie = "";

beforeAll(async () => {
	app = await createApp();
});

beforeEach(async () => {
	resetMockIds();
	resetMock(holder.prisma);
	mock = holder.prisma;

	const admin = await seedUser(mock, { email: "admin@nostos.photos", role: "ADMIN" });

	adminCookie = sessionCookie(await seedSession(mock, admin.id));
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function createService(name: string, slug: string) {
	return app.inject({
		method: "POST",
		url: "/v1/services",
		headers: { cookie: adminCookie },
		payload: { name, slug },
	});
}

async function moveService(id: string, direction: "up" | "down") {
	return app.inject({
		method: "POST",
		url: `/v1/services/${id}/move`,
		headers: { cookie: adminCookie },
		payload: { direction },
	});
}

async function listSlugs(): Promise<string[]> {
	const list = await app.inject({ method: "GET", url: "/v1/services" });

	return list.json().items.map((service: { slug: string }) => service.slug);
}

describe("service ordering", () => {
	it("assigns 1-based positions in creation order", async () => {
		const first = await createService("Weddings", "weddings");
		const second = await createService("Portraits", "portraits");

		expect(first.statusCode).toBe(201);
		expect(first.json().position).toBe(1);
		expect(second.json().position).toBe(2);
	});

	it("swaps a service with its upper neighbour", async () => {
		await createService("Weddings", "weddings");
		const second = await createService("Portraits", "portraits");

		const moved = await moveService(second.json().id as string, "up");

		expect(moved.statusCode).toBe(200);
		expect(moved.json().position).toBe(1);
		expect(auditActions(mock)).toContain("services.move");
		expect(await listSlugs()).toEqual(["portraits", "weddings"]);
		expect(mock.service.rows.map((row) => row.position).sort()).toEqual([1, 2]);
	});

	it("swaps a service with its lower neighbour", async () => {
		const first = await createService("Weddings", "weddings");
		await createService("Portraits", "portraits");
		await createService("Families", "families");

		const moved = await moveService(first.json().id as string, "down");

		expect(moved.statusCode).toBe(200);
		expect(moved.json().position).toBe(2);
		expect(await listSlugs()).toEqual(["portraits", "weddings", "families"]);
		expect(mock.service.rows.map((row) => row.position).sort()).toEqual([1, 2, 3]);
	});

	it("rejects moves past either end without changing positions", async () => {
		const first = await createService("Weddings", "weddings");
		const last = await createService("Portraits", "portraits");

		const aboveTop = await moveService(first.json().id as string, "up");
		const belowBottom = await moveService(last.json().id as string, "down");

		expect(aboveTop.statusCode).toBe(400);
		expect(belowBottom.statusCode).toBe(400);
		expect(await listSlugs()).toEqual(["weddings", "portraits"]);
	});

	it("swaps with the nearest neighbour across gaps left by deletes", async () => {
		const first = await createService("Weddings", "weddings");
		const middle = await createService("Portraits", "portraits");
		const last = await createService("Families", "families");

		const deleted = await app.inject({
			method: "DELETE",
			url: `/v1/services/${middle.json().id as string}`,
			headers: { cookie: adminCookie },
		});

		expect(deleted.statusCode).toBe(200);

		const up = await moveService(last.json().id as string, "up");

		expect(up.statusCode).toBe(200);
		expect(up.json().position).toBe(1);
		expect(await listSlugs()).toEqual(["families", "weddings"]);

		const down = await moveService(last.json().id as string, "down");

		expect(down.statusCode).toBe(200);
		expect(down.json().position).toBe(3);
		expect(await listSlugs()).toEqual(["weddings", "families"]);
		expect(mock.service.rows.find((row) => row.id === first.json().id)?.position).toBe(1);
	});

	it("returns 409 and keeps the order when a concurrent move lands first", async () => {
		const first = await createService("Weddings", "weddings");
		const second = await createService("Portraits", "portraits");
		const findFirst = mock.service.findFirst.bind(mock.service);

		// The sibling is read, then another request moves it before the swap.
		vi.spyOn(mock.service, "findFirst").mockImplementationOnce((args) => {
			const sibling = findFirst(args);
			const row = mock.service.rows.find((candidate) => candidate.id === first.json().id);

			if (row) {
				row.position = 5;
			}

			return sibling;
		});

		const moved = await moveService(second.json().id as string, "up");

		expect(moved.statusCode).toBe(409);
		expect(mock.service.rows.find((row) => row.id === second.json().id)?.position).toBe(2);
		expect(mock.service.rows.find((row) => row.id === first.json().id)?.position).toBe(5);
		expect(auditActions(mock)).not.toContain("services.move");
	});

	it.each(["P2002", "P2034"])("returns 409 and keeps the order when the swap fails with %s", async (code) => {
		await createService("Weddings", "weddings");
		const second = await createService("Portraits", "portraits");
		const updateMany = mock.service.updateMany.bind(mock.service);

		vi.spyOn(mock.service, "updateMany")
			.mockImplementationOnce(updateMany)
			.mockImplementationOnce(() => {
				throw new Prisma.PrismaClientKnownRequestError("Swap rejected by the database", {
					code,
					clientVersion: Prisma.prismaVersion.client,
				});
			});

		const moved = await moveService(second.json().id as string, "up");

		expect(moved.statusCode).toBe(409);
		expect(await listSlugs()).toEqual(["weddings", "portraits"]);
		expect(mock.service.rows.map((row) => row.position).sort()).toEqual([1, 2]);
	});

	it("requires an admin session to move a service", async () => {
		const created = await createService("Weddings", "weddings");

		const anonymous = await app.inject({
			method: "POST",
			url: `/v1/services/${created.json().id as string}/move`,
			payload: { direction: "up" },
		});

		expect(anonymous.statusCode).toBe(401);
	});
});
