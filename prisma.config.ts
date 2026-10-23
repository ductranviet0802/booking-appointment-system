import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.js",
  },
  // CLI only (migrate/studio); the app and seed connect with DATABASE_URL. Migrate needs a direct
  // connection where DATABASE_URL goes through a pooler (PgBouncer).
  datasource: {
    url: process.env.POSTGRES_URL_NON_POOLING || env("DATABASE_URL"),
  },
});
