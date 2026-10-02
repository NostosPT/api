import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 connection config. Migrate reads DATABASE_URL from here;
// application code passes the connection to PrismaClient (see src/db).
export default defineConfig({
	schema: "prisma/schema.prisma",
	migrations: {
		path: "prisma/migrations"
	},
	datasource: {
		url: env("DATABASE_URL")
	}
});
