import { signAuthToken, verifyAuthToken } from "@/lib/auth";

describe("auth token", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = "test-super-secret-key-with-min-32-characters";
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it("sign and verify roundtrip", async () => {
    const token = await signAuthToken({
      userId: "user_1",
      email: "demo@example.com",
      name: "Demo User",
      role: "PATIENT",
    });

    const payload = await verifyAuthToken(token);

    expect(payload.userId).toBe("user_1");
    expect(payload.email).toBe("demo@example.com");
    expect(payload.role).toBe("PATIENT");
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});
