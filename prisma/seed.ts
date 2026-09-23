import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "../src/generated/prisma/client.js";

// Creates the first admin account from ADMIN_EMAIL / ADMIN_PASSWORD. Safe to re-run.
const email = process.env["ADMIN_EMAIL"]?.toLowerCase();
const password = process.env["ADMIN_PASSWORD"];
if (!email || !password || password.length < 12) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 chars) to seed the first admin.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env["DATABASE_URL"]! }) });

const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const user = await prisma.user.upsert({
  where: { email },
  create: { email, name: process.env["ADMIN_NAME"] ?? "Admin", role: "ADMIN", passwordHash },
  update: {},
});
console.log(`Admin ready: ${user.email}`);

await prisma.$disconnect();
