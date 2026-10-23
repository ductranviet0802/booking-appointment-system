// The database refuses what 03 forbids (runs against the service's real, seeded database; every case rolls back).
import type { PoolClient } from "pg";
import { pool } from "@/lib/prisma";

async function violation(sql: string, params: unknown[] = []): Promise<string | null> {
  const c: PoolClient = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(sql, params);
    return null;
  } catch (e) {
    return (e as { constraint?: string }).constraint ?? (e as Error).message;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

afterAll(() => pool.end());

describe("03 constraints", () => {
  it("a frame is never booked beyond its capacity (F4-07)", async () => {
    expect(await violation(`UPDATE slots SET reserved_count = capacity + 1 WHERE id = (SELECT id FROM slots LIMIT 1)`))
      .toBe("slots_not_overbooked");
  });

  it("one doctor cannot hold two frames at the same date and time, at any clinic", async () => {
    expect(await violation(`
      INSERT INTO slots (clinic_id, department_id, doctor_id, slot_date, start_time, end_time, capacity, status, generated_run_id, updated_at)
      SELECT (SELECT id FROM clinics WHERE id <> s.clinic_id LIMIT 1), department_id, doctor_id, slot_date, start_time, end_time,
             1, 'OPEN', generated_run_id, now()
      FROM slots s LIMIT 1`)).toBe("slots_doctor_id_slot_date_start_time_key");
  });

  it("shift patterns of one doctor never overlap, across clinics (F3-04)", async () => {
    expect(await violation(`
      INSERT INTO doctor_shift_patterns (doctor_id, clinic_id, department_id, weekday, band, start_time, end_time, valid_from, updated_at)
      SELECT doctor_id, (SELECT id FROM clinics WHERE id <> p.clinic_id LIMIT 1), department_id, weekday, band,
             start_time + interval '30 minutes', end_time, valid_from + 1, now()
      FROM doctor_shift_patterns p LIMIT 1`)).toBe("dsp_no_overlap");
  });

  it("an account has one SELF patient", async () => {
    expect(await violation(`
      INSERT INTO patients (account_id, relation, name_type, family_name, given_name, family_name_kana, given_name_kana,
                            birth_date, sex, postcode, prefecture, city, address_line, phone, created_by_kind, updated_at)
      SELECT account_id, 'SELF', name_type, family_name, given_name, family_name_kana, given_name_kana,
             birth_date, sex, postcode, prefecture, city, address_line, phone, created_by_kind, now()
      FROM patients WHERE relation = 'SELF' LIMIT 1`)).toBe("patients_one_self_per_account");
  });

  it("an e-mail is unique among accounts that are not withdrawn, and stored lower-cased", async () => {
    const copy = (email: string, status: string) => violation(`
      INSERT INTO accounts (email, password_hash, role, status, updated_at)
      SELECT $1, password_hash, role, $2, now() FROM accounts WHERE email = 'yamada.taro@example.jp'`, [email, status]);
    expect(await copy("yamada.taro@example.jp", "ACTIVE")).toBe("accounts_email_active_key");
    expect(await copy("yamada.taro@example.jp", "WITHDRAWN")).toBeNull();
    expect(await copy("Yamada.Taro2@example.jp", "ACTIVE")).toBe("accounts_email_lower");
  });

  it("only 自費 visit types carry a price, and 問診 is required exactly for 初診 (F2-02, F2-03)", async () => {
    expect(await violation(`UPDATE visit_types SET price_yen = 1000 WHERE category = 'FIRST'`)).toBe("vt_price_self_pay");
    expect(await violation(`UPDATE visit_types SET questionnaire_required = false WHERE category = 'FIRST'`)).toBe("vt_questionnaire_first");
  });

  it("予約番号 has the AAAA0000 form without I and O (F7-01)", async () => {
    expect(await violation(`UPDATE bookings SET booking_no = 'ABIO1234' WHERE id = (SELECT id FROM bookings LIMIT 1)`))
      .toBe("bookings_booking_no_format");
  });

  it("B1 queues one reminder per booking and channel", async () => {
    expect(await violation(`
      INSERT INTO notifications (event, channel, language, booking_id, to_address, status, queued_at, updated_at)
      SELECT 'NT02_REMIND', 'MAIL', 'JA', b.id, 'x@example.jp', 'QUEUED', now(), now()
      FROM (SELECT id FROM bookings LIMIT 1) b, generate_series(1, 2)`)).toBe("notifications_remind_once");
  });

  it("a doctor always has a language list (03 §3.7, default {ja})", async () => {
    expect(await violation(`UPDATE doctors SET languages = NULL WHERE id = (SELECT id FROM doctors LIMIT 1)`)).toBe("doctors_languages_required");
  });

  it("department codes are immutable and audit rows are never updated", async () => {
    expect(await violation(`UPDATE departments SET code = 'naika2' WHERE code = 'naika'`)).toMatch(/immutable/);
    expect(await violation(`
      DO $$ DECLARE i bigint; BEGIN
        INSERT INTO audit_logs (at, action, updated_at) VALUES (now(), 'LOGIN_OK', now()) RETURNING id INTO i;
        UPDATE audit_logs SET action = 'X' WHERE id = i;
      END $$`)).toMatch(/append-only/);
  });
});
