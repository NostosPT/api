import "../test/env.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockPrisma, resetMock, simulateLatency } from "../test/prisma-mock.js";

const holder = { prisma: createMockPrisma() };

vi.mock("./prisma.js", () => ({ prisma: holder.prisma }));

// Imported after vi.mock is registered: this module loads ./prisma.js eagerly.
const { allocateCode, formatCode, insertWithCode } = await import("./sequentialCodes.js");

const mock = holder.prisma;
const year = new Date().getFullYear();

function counter(scope: string, forYear = year): unknown {
	return mock.codeCounter.rows.find((row) => row.scope === scope && row.year === forYear)?.value;
}

beforeEach(() => {
	resetMock(mock);
});

describe("formatCode", () => {
	it("pads to three digits and grows past 999 without truncating", () => {
		expect(formatCode("CLIENT", 2026, 1)).toBe("CLI-2026-001");
		expect(formatCode("CLIENT", 2026, 42)).toBe("CLI-2026-042");
		expect(formatCode("SERVICE_REQUEST", 2026, 999)).toBe("REQ-2026-999");
		expect(formatCode("SERVICE_REQUEST", 2026, 1000)).toBe("REQ-2026-1000");
		expect(formatCode("SERVICE_REQUEST", 2026, 123456)).toBe("REQ-2026-123456");
	});
});

describe("allocateCode", () => {
	it("counts each scope and year independently", async () => {
		const in2026 = new Date(2026, 5, 1);
		const in2027 = new Date(2027, 0, 1);

		expect(await allocateCode("CLIENT", in2026)).toBe("CLI-2026-001");
		expect(await allocateCode("CLIENT", in2026)).toBe("CLI-2026-002");
		expect(await allocateCode("SERVICE_REQUEST", in2026)).toBe("REQ-2026-001");
		expect(await allocateCode("CLIENT", in2027)).toBe("CLI-2027-001");
		expect(counter("CLIENT", 2026)).toBe(2);
	});

	it("crosses 999 numerically", async () => {
		mock.codeCounter.create({ data: { scope: "SERVICE_REQUEST", year, value: 998 } });

		expect(await allocateCode("SERVICE_REQUEST")).toBe(`REQ-${year}-999`);
		expect(await allocateCode("SERVICE_REQUEST")).toBe(`REQ-${year}-1000`);
		expect(await allocateCode("SERVICE_REQUEST")).toBe(`REQ-${year}-1001`);
	});

	it("hands out distinct numbers to concurrent callers", async () => {
		const restore = simulateLatency(mock);
		const codes = await Promise.all(Array.from({ length: 50 }, () => allocateCode("CLIENT"))).finally(restore);

		expect(new Set(codes).size).toBe(50);
		expect(counter("CLIENT")).toBe(50);
	});
});

describe("insertWithCode", () => {
	function seedClient(clientCode: string): void {
		mock.client.create({ data: { clientCode, email: `${clientCode}@nostos.photos`, name: clientCode, status: "LEAD" } });
	}

	function insertClient(email: string) {
		return (clientCode: string) => Promise.resolve(
			mock.client.create({ data: { clientCode, email, name: "New", status: "LEAD" } }),
		);
	}

	it("retries with the next number when the code is already taken", async () => {
		seedClient(`CLI-${year}-001`);
		seedClient(`CLI-${year}-002`);

		const created = await insertWithCode("CLIENT", insertClient("new@nostos.photos"));

		expect(created.clientCode).toBe(`CLI-${year}-003`);
		expect(counter("CLIENT")).toBe(3);
	});

	it("does not retry a unique violation on another column", async () => {
		seedClient(`CLI-${year}-900`);
		const insert = vi.fn(insertClient(`CLI-${year}-900@nostos.photos`));

		await expect(insertWithCode("CLIENT", insert)).rejects.toMatchObject({ code: "P2002" });
		expect(insert).toHaveBeenCalledTimes(1);
		expect(counter("CLIENT")).toBe(1);
	});

	it("gives up after a bounded number of attempts", async () => {
		for (let number = 1; number <= 10; number += 1) {
			seedClient(`CLI-${year}-${String(number).padStart(3, "0")}`);
		}

		const insert = vi.fn(insertClient("new@nostos.photos"));

		await expect(insertWithCode("CLIENT", insert)).rejects.toMatchObject({ code: "P2002" });
		expect(insert).toHaveBeenCalledTimes(5);
	});

	it("propagates other errors without retrying", async () => {
		const insert = vi.fn(() => Promise.reject(new Error("connection lost")));

		await expect(insertWithCode("SERVICE_REQUEST", insert)).rejects.toThrow("connection lost");
		expect(insert).toHaveBeenCalledTimes(1);
	});
});
