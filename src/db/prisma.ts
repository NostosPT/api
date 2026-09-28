import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Single shared PrismaClient for the process. Repositories (Phase 1) receive
// this instance via constructor injection ÔÇö never import it directly in
// routes or services, preserving Routes ÔåÆ Services ÔåÆ Repositories ÔåÆ Prisma.
//
// Prisma 7 connects through a driver adapter (no datasourceUrl option).
const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
	const connectionString = process.env.DATABASE_URL;

	if (!connectionString) {
		throw new Error("Missing DATABASE_URL environment variable");
	}

	const adapter = new PrismaPg({ connectionString });

	return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}

export async function disconnectPrisma(): Promise<void> {
	await prisma.$disconnect();
}
