// B5 保存期間削除 (06 §B5, §5 [OD-8]; F10-04 / F10-05, F9-06; Q-002, Q-022): every row class of §5 with its action,
// its period read from system_settings.retention_* (a missing / bad value fails that class only, the others go on).
// Batches of 1 000 keys, each its own transaction: lock, re-check the class condition under the lock, act. A failing
// batch rolls back and the job goes on with the next class → PARTIAL; the next run picks up the rest. Keys are walked
// in order (keyset), so a row that fails or no longer qualifies is never picked twice in a run — a run always ends.
// Booking data is written under lockPerson → lockBooking in patient-id order (the core's order, lib/booking/core).
import { Prisma } from "@prisma/client";
import { lockBooking, lockPerson } from "@/lib/booking/core";
import { addDays, todayJst } from "@/lib/datetime";
import { deleteExportFile, exportFileExists as fileExists } from "@/lib/export/store";
import { prisma } from "@/lib/prisma";
import type { Job, JobResult } from "@/lib/batch/runner";

type Tx = Prisma.TransactionClient;
type Cut = { today: string; date: string; at: Date }; // date: DATE bound (JST) for slot_date rules; at: instant bound
type Counts = Record<string, number>;
type Cls = {
  name: string;
  setting: string;
  unit: "days" | "years";
  key: string; // key column, also the keyset order
  type: "uuid" | "bigint" | "text";
  from: (c: Cut) => Prisma.Sql; // FROM … WHERE <the §5 condition>
  lock?: (tx: Tx, ids: string[]) => Promise<unknown>;
  filter?: (ids: string[]) => Promise<string[]>;
  act: (tx: Tx, ids: string[], now: Date) => Promise<Counts>;
  noTx?: true; // file deletes cannot roll back; the row is the record
};

export const B5_BATCH = 1_000;

/** the bound for `n` days / years before now (instants) and before today JST (dates) */
export function cutOf(n: number, unit: "days" | "years", now: Date): Cut {
  const today = todayJst(now);
  if (unit === "days") return { today, date: addDays(today, -n), at: new Date(now.getTime() - n * 86_400_000) };
  const [y, m, d] = today.split("-").map(Number);
  const at = new Date(now);
  at.setUTCFullYear(at.getUTCFullYear() - n);
  return { today, date: new Date(Date.UTC(y - n, m - 1, d)).toISOString().slice(0, 10), at };
}

// ── locks (same order as the core: account → patient → booking, patients by id) ──────────────────────────────────

/** lockPerson takes the account and patient row locks before it refuses a merged / anonymised patient, so the
 *  refusal still leaves the rows locked — B5 must purge exactly those patients' old data */
const lockPersonRows = (tx: Tx, patientId: string) => lockPerson(tx, patientId).catch(() => undefined);

async function lockBookings(tx: Tx, ids: string[]) {
  const rows = await tx.booking.findMany({ where: { id: { in: ids } }, select: { id: true, patientId: true }, orderBy: [{ patientId: "asc" }, { id: "asc" }] });
  let last = "";
  for (const b of rows) {
    if (b.patientId !== last) await lockPersonRows(tx, (last = b.patientId));
    await lockBooking(tx, b.id);
  }
}

async function lockPatients(tx: Tx, patientIds: string[]) {
  for (const id of [...patientIds].sort()) {
    await lockPersonRows(tx, id);
    await tx.$queryRaw`SELECT 1 FROM bookings WHERE patient_id = ${id}::uuid ORDER BY id FOR UPDATE`;
  }
}

const lockAccounts = (tx: Tx, ids: string[]) => tx.$queryRaw`SELECT 1 FROM accounts WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;

// ── actions ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** 06 §B5 "Anonymise": names 削除済, kana サクジョズミ, birth_date 1 Jan, postcode / address / phone '', booking notes and
 *  cancel_reason_text null; ids, dates, clinic, department, visit type, status stay */
async function anonymise(tx: Tx, patientIds: string[], now: Date) {
  const patients = await tx.$executeRaw`
    UPDATE patients SET account_id = NULL, family_name = '削除済', given_name = '削除済', family_name_kana = 'サクジョズミ',
      given_name_kana = 'サクジョズミ', birth_date = date_trunc('year', birth_date)::date, postcode = '', prefecture = '', city = '',
      town = '', address_line = '', building = '', phone = '', anonymized_at = ${now}, updated_at = ${now}
    WHERE id = ANY(${patientIds}::uuid[]) AND anonymized_at IS NULL`;
  await tx.$executeRaw`
    UPDATE bookings SET notes = NULL, cancel_reason_text = NULL, anonymized_at = ${now}, updated_at = ${now}
    WHERE patient_id = ANY(${patientIds}::uuid[])`;
  return patients;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

export const CLASSES: Cls[] = [
  {
    // 90 days after the patient's last visit: no RESERVED / CHECKED_IN booking of the patient on or after the bound
    name: "questionnaires", setting: "retention_questionnaire_days", unit: "days", key: "q.booking_id", type: "uuid",
    from: (c) => Prisma.sql`FROM questionnaires q JOIN bookings b ON b.id = q.booking_id
      WHERE b.slot_date < ${c.date}::date AND NOT EXISTS (SELECT 1 FROM bookings o WHERE o.patient_id = b.patient_id
        AND o.status IN ('RESERVED', 'CHECKED_IN') AND o.slot_date >= ${c.date}::date)`,
    lock: lockBookings,
    act: async (tx, k) => ({ questionnaires: (await tx.questionnaire.deleteMany({ where: { bookingId: { in: k } } })).count }),
  },
  {
    name: "bookings.notes", setting: "retention_notes_days", unit: "days", key: "b.id", type: "uuid",
    from: (c) => Prisma.sql`FROM bookings b WHERE b.notes IS NOT NULL AND b.slot_date < ${c.date}::date`,
    lock: lockBookings,
    act: async (tx, k) => ({ "bookings.notes": (await tx.booking.updateMany({ where: { id: { in: k } }, data: { notes: null } })).count }),
  },
  {
    name: "bookings.cancel_reason_text", setting: "retention_cancel_text_days", unit: "days", key: "b.id", type: "uuid",
    from: (c) => Prisma.sql`FROM bookings b WHERE b.cancel_reason_text IS NOT NULL AND b.canceled_at < ${c.at}`,
    lock: lockBookings,
    act: async (tx, k) => ({ "bookings.cancel_reason_text": (await tx.booking.updateMany({ where: { id: { in: k } }, data: { cancelReasonText: null } })).count }),
  },
  {
    // booking_slots, booking_events and the questionnaire go with the booking (FK CASCADE); notifications keep a null booking
    name: "bookings", setting: "retention_booking_years", unit: "years", key: "b.id", type: "uuid",
    from: (c) => Prisma.sql`FROM bookings b WHERE b.slot_date < ${c.date}::date`,
    lock: lockBookings,
    act: async (tx, k) => {
      const where = { bookingId: { in: k } };
      const [events, slots] = await Promise.all([tx.bookingEvent.count({ where }), tx.bookingSlot.count({ where })]);
      return { bookings: (await tx.booking.deleteMany({ where: { id: { in: k } } })).count, booking_events: events, booking_slots: slots };
    },
  },
  {
    // no account, not anonymised, last booking date (no booking: the registration date) before the bound
    name: "patients.no_account", setting: "retention_patient_years", unit: "years", key: "p.id", type: "uuid",
    from: (c) => Prisma.sql`FROM patients p WHERE p.account_id IS NULL AND p.anonymized_at IS NULL
      AND COALESCE((SELECT max(b.slot_date) FROM bookings b WHERE b.patient_id = p.id), (p.created_at AT TIME ZONE 'Asia/Tokyo')::date) < ${c.date}::date`,
    lock: lockPatients,
    act: async (tx, k, now) => ({ "patients.no_account": await anonymise(tx, k, now) }),
  },
  {
    // Q-022: the period is the setting (initial 30). An account whose patients still hold a future RESERVED booking waits
    name: "accounts.withdrawn", setting: "retention_withdrawn_days", unit: "days", key: "a.id", type: "uuid",
    from: (c) => Prisma.sql`FROM accounts a WHERE a.status = 'WITHDRAWN' AND a.withdrawn_at < ${c.at}
      AND NOT EXISTS (SELECT 1 FROM bookings b JOIN patients p ON p.id = b.patient_id
        WHERE p.account_id = a.id AND b.status = 'RESERVED' AND b.slot_date >= ${c.today}::date)`,
    lock: async (tx, k) => {
      await lockPatients(tx, ids(await tx.patient.findMany({ where: { accountId: { in: k } }, select: { id: true } })));
      await lockAccounts(tx, k);
    },
    act: async (tx, k, now) => {
      const patients = await anonymise(tx, ids(await tx.patient.findMany({ where: { accountId: { in: k } }, select: { id: true } })), now);
      return { "accounts.withdrawn": (await tx.account.deleteMany({ where: { id: { in: k } } })).count, "patients.withdrawn": patients };
    },
  },
  {
    // F9-06: never verified → account, its patient(s) and consents together (sessions / auth_tokens go by FK CASCADE).
    // A person with a booking (a staff booking, S02) is kept: deleting it is refused (FK) and would fail its batch every
    // night (Q-051).
    name: "accounts.pending", setting: "retention_pending_days", unit: "days", key: "a.id", type: "uuid",
    from: (c) => Prisma.sql`FROM accounts a WHERE a.status = 'PENDING' AND a.created_at < ${c.at}
      AND NOT EXISTS (SELECT 1 FROM patients p JOIN bookings b ON b.patient_id = p.id WHERE p.account_id = a.id)`,
    lock: lockAccounts,
    act: async (tx, k) => {
      const pids = ids(await tx.patient.findMany({ where: { accountId: { in: k } }, select: { id: true } }));
      const consents = await tx.consent.count({ where: { accountId: { in: k } } });
      await tx.patientCard.deleteMany({ where: { patientId: { in: pids } } });
      const patients = (await tx.patient.deleteMany({ where: { id: { in: pids } } })).count;
      return { "accounts.pending": (await tx.account.deleteMany({ where: { id: { in: k } } })).count, "patients.pending": patients, "consents.pending": consents };
    },
  },
  {
    name: "sessions", setting: "retention_session_days", unit: "days", key: "s.id", type: "uuid",
    from: (c) => Prisma.sql`FROM sessions s WHERE s.expires_at < ${c.at}`,
    act: async (tx, k) => ({ sessions: (await tx.session.deleteMany({ where: { id: { in: k } } })).count }),
  },
  {
    name: "auth_tokens", setting: "retention_session_days", unit: "days", key: "t.token_hash", type: "text",
    from: (c) => Prisma.sql`FROM auth_tokens t WHERE t.expires_at < ${c.at}`,
    act: async (tx, k) => ({ auth_tokens: (await tx.authToken.deleteMany({ where: { tokenHash: { in: k } } })).count }),
  },
  {
    name: "notifications", setting: "retention_notification_days", unit: "days", key: "n.id", type: "uuid",
    from: (c) => Prisma.sql`FROM notifications n WHERE n.queued_at < ${c.at}`,
    act: async (tx, k) => ({ notifications: (await tx.notification.deleteMany({ where: { id: { in: k } } })).count }),
  },
  {
    // the file goes, the row stays (storage_key too: CHECK ef_done_file); a file already gone is not counted again.
    // Only DONE rows hold a file — a DISCLOSURE stuck in BUILDING is A06's (06 §5)
    name: "export_files.file", setting: "retention_export_file_days", unit: "days", key: "e.id", type: "uuid",
    from: (c) => Prisma.sql`FROM export_files e WHERE e.status = 'DONE' AND e.created_at < ${c.at}`,
    filter: async (k) => {
      const rows = await prisma.exportFile.findMany({ where: { id: { in: k } }, select: { id: true, storageKey: true }, orderBy: { id: "asc" } });
      const live = await Promise.all(rows.map((r) => (r.storageKey ? fileExists(r.storageKey) : false)));
      return rows.filter((_, i) => live[i]).map((r) => r.id);
    },
    act: async (tx, k) => {
      const rows = await tx.exportFile.findMany({ where: { id: { in: k } }, select: { storageKey: true } });
      for (const r of rows) await deleteExportFile(r.storageKey!);
      return { "export_files.file": rows.length };
    },
    noTx: true,
  },
  {
    name: "export_files", setting: "retention_export_row_years", unit: "years", key: "e.id", type: "uuid",
    from: (c) => Prisma.sql`FROM export_files e WHERE e.status <> 'BUILDING' AND e.created_at < ${c.at}`,
    act: async (tx, k) => {
      const rows = await tx.exportFile.findMany({ where: { id: { in: k } }, select: { storageKey: true } });
      const n = (await tx.exportFile.deleteMany({ where: { id: { in: k } } })).count;
      for (const r of rows) if (r.storageKey) await deleteExportFile(r.storageKey); // normally gone 30 days after creation
      return { export_files: n };
    },
  },
  {
    // a frame locked FOR UPDATE: a booking taking it at the same moment commits first and the re-check keeps the frame,
    // or waits and then fails on booking_slots_slot_id_fkey — never a booking without its frame
    name: "slots", setting: "retention_slot_days", unit: "days", key: "s.id", type: "uuid",
    from: (c) => Prisma.sql`FROM slots s WHERE s.slot_date < ${c.date}::date AND NOT EXISTS (SELECT 1 FROM booking_slots bs WHERE bs.slot_id = s.id)`,
    lock: async (tx, k) => { await tx.$queryRaw`SELECT 1 FROM slots WHERE id = ANY(${k}::uuid[]) ORDER BY id FOR UPDATE`; },
    act: async (tx, k) => ({ slots: (await tx.slot.deleteMany({ where: { id: { in: k } } })).count }),
  },
  {
    // runs still named by a kept frame or holiday (FK RESTRICT) stay until those go
    name: "batch_runs", setting: "retention_batch_run_years", unit: "years", key: "r.id", type: "uuid",
    from: (c) => Prisma.sql`FROM batch_runs r WHERE r.started_at < ${c.at}
      AND NOT EXISTS (SELECT 1 FROM slots s WHERE s.generated_run_id = r.id) AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.last_run_id = r.id)`,
    act: async (tx, k) => ({ batch_runs: (await tx.batchRun.deleteMany({ where: { id: { in: k } } })).count }),
  },
  {
    // Q-002: DELETE of audit_logs only here, rows older than the period (the trigger refuses UPDATE)
    name: "audit_logs", setting: "retention_audit_years", unit: "years", key: "l.id", type: "bigint",
    from: (c) => Prisma.sql`FROM audit_logs l WHERE l.at < ${c.at}`,
    act: async (tx, k) => ({ audit_logs: (await tx.auditLog.deleteMany({ where: { id: { in: k.map(BigInt) } } })).count }),
  },
];

/** the next keys of a class after `after`, or which of `only` still qualify */
async function pick(db: Tx, c: Cls, cut: Cut, by: { after: string | null } | { only: string[] }) {
  const key = Prisma.raw(c.key);
  const type = Prisma.raw(c.type);
  const where = "only" in by
    ? Prisma.sql`AND ${key} = ANY(${by.only}::${Prisma.raw(`${c.type}[]`)})`
    : by.after === null ? Prisma.empty : Prisma.sql`AND ${key} > ${by.after}::${type}`;
  const rows = await db.$queryRaw<{ k: string }[]>`SELECT ${key}::text AS k ${c.from(cut)} ${where} ORDER BY ${key} LIMIT ${B5_BATCH}`;
  return rows.map((r) => r.k);
}

export const b5Job: Job = async (ctx) => {
  if (ctx.clinicId) throw new Error("B5 runs for all clinics (no --clinic)");
  const now = new Date();
  const settings = new Map((await prisma.systemSetting.findMany({ where: { key: { startsWith: "retention_" } } })).map((s) => [s.key, s.value]));
  const counts: Counts = {};
  const failed: string[] = [];
  let read = 0;
  const add = (got: Counts) => { for (const [k, n] of Object.entries(got)) counts[k] = (counts[k] ?? 0) + n; };

  for (const c of CLASSES) {
    counts[c.name] ??= 0;
    const raw = settings.get(c.setting);
    if (!raw || !/^[1-9][0-9]{0,4}$/.test(raw)) {
      failed.push(`${c.name}: ${c.setting}=${raw ?? "なし"}`);
      continue;
    }
    const cut = cutOf(Number(raw), c.unit, now);
    let after: string | null = null;
    try {
      for (;;) {
        const keys = await pick(prisma, c, cut, { after });
        if (!keys.length) break;
        after = keys[keys.length - 1];
        const found = c.filter ? await c.filter(keys) : keys;
        read += found.length;
        if (ctx.dryRun) {
          add({ [c.name]: found.length });
          continue;
        }
        if (!found.length) continue;
        const work = async (tx: Tx) => {
          await c.lock?.(tx, found);
          let live = await pick(tx, c, cut, { only: found }); // re-check under the locks
          if (c.filter) live = await c.filter(live);
          return live.length ? c.act(tx, live, now) : {};
        };
        add(c.noTx ? await work(prisma) : await prisma.$transaction(work, { timeout: 120_000, maxWait: 20_000 }));
      }
    } catch (e) {
      failed.push(`${c.name}: ${e instanceof Error ? e.message.split("\n").pop() : String(e)}`.slice(0, 200));
    }
  }

  const written = Object.values(counts).reduce((s, n) => s + n, 0);
  if (!ctx.dryRun) {
    // one RETENTION_PURGE row per run: counts per table, no content
    await prisma.auditLog.create({
      data: { at: now, action: "RETENTION_PURGE", targetType: "batch_run", targetId: ctx.runId, detail: { counts, failed: failed.map((f) => f.split(":")[0]) } },
    });
  }
  const message = `${ctx.dryRun ? "（試行）" : ""}${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join("・")}${failed.length ? `／失敗 ${failed.join("; ")}` : ""}`;
  const status: JobResult["status"] = !failed.length ? "SUCCESS" : failed.length === CLASSES.length ? "FAILED" : "PARTIAL";
  return { status, read, written: ctx.dryRun ? 0 : written, errors: failed.length, message };
};
