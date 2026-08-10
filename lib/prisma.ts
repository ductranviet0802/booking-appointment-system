import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const globalForPool = globalThis as unknown as { prismaPool?: Pool };

function getConnectionString() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  return url;
}

const rawConnectionString = getConnectionString();
const needsSsl = rawConnectionString.includes("sslmode=require");
const connectionString = needsSsl
  ? rawConnectionString.replace(/[?&]sslmode=require/g, (m) => m.startsWith("?") ? "?" : "").replace(/\?&/, "?").replace(/\?$/, "")
  : rawConnectionString;

const pool =
  globalForPool.prismaPool ??
  new Pool({
    connectionString,
    max: 10,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });

const adapter = new PrismaPg(pool);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPool.prismaPool = pool;
}
