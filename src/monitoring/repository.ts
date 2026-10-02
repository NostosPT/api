import { prisma } from "../db/prisma.js";

// Data access for health monitoring. The only module here that touches Prisma.

export async function pingDatabase(): Promise<void> {
	await prisma.$queryRaw`SELECT 1`;
}
