/* eslint-disable @typescript-eslint/no-require-imports */
const {
  buildCandidates,
  feedSlots,
  parseOptions,
  rangeForOptions,
  slotTimes,
  validateWindowDays,
} = require("../prisma/seed/slot-feed");

describe("slot feed", () => {
  it("builds inclusive rolling ranges and Vietnam UTC times", () => {
    const range = rangeForOptions({ windowDays: 30 }, new Date("2026-12-31T12:00:00Z"));
    expect(range.from.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2027-01-30T00:00:00.000Z");
    expect(slotTimes()).toHaveLength(16);
    expect(slotTimes()[0]).toEqual({ startTime: "02:00:00", endTime: "02:30:00" });
    expect(slotTimes()[15]).toEqual({ startTime: "09:30:00", endTime: "10:00:00" });
    expect(buildCandidates([{ id: "doctor-1" }], range)).toHaveLength(31 * 16);
  });

  it("supports leap years and whole month ranges", () => {
    const leap = rangeForOptions({ month: "2028-02" });
    expect(leap.from.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    expect(leap.to.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(rangeForOptions({ month: "2026-11" }).to.toISOString()).toBe("2026-11-30T00:00:00.000Z");
  });

  it("validates options and configured inclusive windows", () => {
    expect(validateWindowDays(1)).toBe(1);
    expect(validateWindowDays(365)).toBe(365);
    expect(() => validateWindowDays(0)).toThrow();
    expect(() => validateWindowDays(366)).toThrow();
    expect(() => parseOptions(["--month", "2026-13"])).toThrow();
    expect(() => parseOptions(["--month", "0001-01"])).toThrow();
    expect(parseOptions(["--month", "2026-11", "--dry-run"])).toEqual({ month: "2026-11", dryRun: true });
  });

  function mockClient({ existing = [] as Array<Record<string, string>>, doctors = [{ id: "doctor-1" }] } = {}) {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    return {
      queries,
      query: jest.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.includes("SELECT id FROM doctors")) return { rows: doctors };
        if (text.includes("SELECT doctor_id")) return { rows: existing };
        return { rows: [] };
      }),
    };
  }

  it("inserts only missing slots and preserves existing booked rows", async () => {
    const client = mockClient({ existing: [{ doctor_id: "doctor-1", date: "2026-02-01", start_time: "02:00:00" }] });
    const result = await feedSlots({ client, options: { month: "2026-02" } });
    expect(result.missing).toBe(28 * 16 - 1);
    expect(result.inserted).toBe(result.missing);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.queries.filter(({ text }) => text.startsWith("INSERT INTO doctor_slots"))).toHaveLength(1);
  });

  it("is idempotent on a second run and locks before reading", async () => {
    const client = mockClient();
    const first = await feedSlots({ client, options: { month: "2026-02" } });
    const insert = client.queries.find(({ text }) => text.startsWith("INSERT INTO doctor_slots"));
    const values = insert?.values ?? [];
    const existing: Array<Record<string, string>> = [];
    for (let index = 0; index < values.length; index += 6) {
      existing.push({ doctor_id: String(values[index + 1]), date: String(values[index + 2]), start_time: String(values[index + 3]) });
    }
    client.query.mockImplementation(async (text: string, queryValues?: unknown[]) => {
      client.queries.push({ text, values: queryValues });
      if (text.includes("SELECT id FROM doctors")) return { rows: [{ id: "doctor-1" }] };
      if (text.includes("SELECT doctor_id")) return { rows: existing };
      return { rows: [] };
    });
    const second = await feedSlots({ client, options: { month: "2026-02" } });
    expect(first.inserted).toBe(448);
    expect(second.missing).toBe(0);
    expect(second.inserted).toBe(0);
    const lockIndex = client.queries.findIndex(({ text }) => text.includes("pg_advisory_xact_lock"));
    const doctorIndex = client.queries.findIndex(({ text }) => text.includes("SELECT id FROM doctors"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(doctorIndex);
  });

  it("rolls back when there are no doctors or insertion fails", async () => {
    const noDoctors = mockClient({ doctors: [] });
    await expect(feedSlots({ client: noDoctors, options: { month: "2026-02" } })).rejects.toThrow("No doctors found");
    expect(noDoctors.queries.some(({ text }) => text === "ROLLBACK")).toBe(true);

    const failedInsert = mockClient();
    failedInsert.query.mockImplementation(async (text: string, values?: unknown[]) => {
      failedInsert.queries.push({ text, values });
      if (text.startsWith("INSERT INTO")) throw new Error("insert failed");
      if (text.includes("SELECT id FROM doctors")) return { rows: [{ id: "doctor-1" }] };
      if (text.includes("SELECT doctor_id")) return { rows: [] };
      return { rows: [] };
    });
    await expect(feedSlots({ client: failedInsert, options: { month: "2026-02" } })).rejects.toThrow("insert failed");
    expect(failedInsert.queries.some(({ text }) => text === "ROLLBACK")).toBe(true);
  });

  it("uses a read-only rollback for dry runs and does not insert", async () => {
    const client = mockClient();
    const result = await feedSlots({ client, options: { month: "2026-02", dryRun: true } });
    expect(result.inserted).toBe(0);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.queries.some(({ text }) => text.startsWith("INSERT INTO"))).toBe(false);
    expect(client.queries.some(({ text }) => text.includes("pg_advisory_xact_lock"))).toBe(false);
  });
});
