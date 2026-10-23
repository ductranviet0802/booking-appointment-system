import { testDbUrl } from "./test-db";

const load = async () => {
  let url: string | undefined;
  await jest.isolateModulesAsync(async () => {
    url = (await import("../prisma.config")).default.datasource?.url;
  });
  return url;
};

describe("prisma.config datasource (CLI / migrate)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("prefers the direct (non-pooling) URL", async () => {
    process.env.DATABASE_URL = "postgresql://pooled";
    process.env.POSTGRES_URL_NON_POOLING = "postgresql://direct";
    expect(await load()).toBe("postgresql://direct");
  });

  it("falls back to DATABASE_URL", async () => {
    process.env.DATABASE_URL = "postgresql://pooled";
    delete process.env.POSTGRES_URL_NON_POOLING;
    expect(await load()).toBe("postgresql://pooled");
  });
});

describe("test database", () => {
  it("is the service database + _test, once", () => {
    const url = "postgresql://u:p@db:5432/booking_w1?schema=public";
    expect(testDbUrl(url)).toBe("postgresql://u:p@db:5432/booking_w1_test?schema=public");
    expect(testDbUrl(testDbUrl(url))).toBe(testDbUrl(url));
  });
});
