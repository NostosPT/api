import "../../test/env.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockPrisma, resetMock, resetMockIds, type MockPrisma } from "../../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("../../db/prisma.js", () => ({ prisma: holder.prisma }));

import { seedUser } from "../../test/helpers.js";

// Smoke test: registerUser creates a user and returns a safe DTO.
describe("registerUser smoke test", () => {
	let mock: MockPrisma;

	beforeEach(() => {
		resetMockIds();
		resetMock(holder.prisma);
		mock = holder.prisma;
	});

	it("creates a user and returns an id", async () => {
		await seedUser(mock, { email: "admin@nostos.photos", password: "Correct Horse 12", role: "ADMIN" });

		const { registerUser } = await import("./service.js");

		const created = await registerUser("actor-id", {
			email: "new@nostos.photos",
			name: "New",
			password: "Correct Horse 12",
			role: "EDITOR",
		});

		expect(typeof created.id).toBe("string");
		expect(created.email).toBe("new@nostos.photos");
		expect(JSON.stringify(created)).not.toContain("passwordHash");
	}, 30_000);
});
