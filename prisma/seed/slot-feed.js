const { randomUUID } = require("node:crypto");

const DEFAULT_BOOKING_WINDOW_DAYS = 30;
const MIN_BOOKING_WINDOW_DAYS = 1;
const MAX_BOOKING_WINDOW_DAYS = 365;
const SLOT_START_HOUR_UTC = 2;
const SLOT_END_HOUR_UTC = 10;
const SLOT_DURATION_MINUTES = 30;
const ADVISORY_LOCK_KEY = 67421931;

function validateWindowDays(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_BOOKING_WINDOW_DAYS || parsed > MAX_BOOKING_WINDOW_DAYS) {
    throw new Error(`BOOKING_WINDOW_DAYS must be an integer from ${MIN_BOOKING_WINDOW_DAYS} to ${MAX_BOOKING_WINDOW_DAYS}.`);
  }
  return parsed;
}

function parseOptions(argv = []) {
  let month;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--month") {
      month = argv[index + 1];
      index += 1;
      if (!month) throw new Error("--month requires YYYY-MM.");
    } else if (argument === "--help" || argument === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (month !== undefined && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 100)) {
    throw new Error("--month must use YYYY-MM format.");
  }
  return { month, dryRun };
}

function utcToday(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function rangeForOptions(options = {}, now = new Date()) {
  if (options.month) {
    const [year, month] = options.month.split("-").map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    return { from: first, to: new Date(Date.UTC(year, month, 0)) };
  }

  const from = utcToday(now);
  const windowDays = validateWindowDays(options.windowDays ?? process.env.BOOKING_WINDOW_DAYS ?? DEFAULT_BOOKING_WINDOW_DAYS);
  return { from, to: addDays(from, windowDays) };
}

function slotTimes() {
  const times = [];
  for (let minutes = SLOT_START_HOUR_UTC * 60; minutes < SLOT_END_HOUR_UTC * 60; minutes += SLOT_DURATION_MINUTES) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
    const minute = String(minutes % 60).padStart(2, "0");
    const endMinutes = minutes + SLOT_DURATION_MINUTES;
    const endHour = String(Math.floor(endMinutes / 60)).padStart(2, "0");
    const endMinute = String(endMinutes % 60).padStart(2, "0");
    times.push({ startTime: `${hour}:${minute}:00`, endTime: `${endHour}:${endMinute}:00` });
  }
  return times;
}

function buildCandidates(doctors, range) {
  const candidates = [];
  for (const doctor of doctors) {
    for (let day = new Date(range.from); day <= range.to; day = addDays(day, 1)) {
      for (const time of slotTimes()) {
        candidates.push({ doctorId: doctor.id, date: isoDate(day), ...time, id: randomUUID() });
      }
    }
  }
  return candidates;
}

function keyOf(row) {
  const dateValue = row.date;
  const timeValue = row.start_time ?? row.startTime;
  const date = dateValue instanceof Date ? isoDate(dateValue) : String(dateValue).slice(0, 10);
  const time = timeValue instanceof Date
    ? timeValue.toISOString().slice(11, 19)
    : String(timeValue).slice(0, 8);
  return `${row.doctor_id ?? row.doctorId}:${date}:${time}`;
}

function makeInsertQuery(rows) {
  const values = [];
  const placeholders = rows.map((row, index) => {
    const offset = index * 6;
    values.push(row.id, row.doctorId, row.date, row.startTime, row.endTime, false);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}::date, $${offset + 4}::time, $${offset + 5}::time, $${offset + 6})`;
  });
  return {
    text: `INSERT INTO doctor_slots (id, doctor_id, date, start_time, end_time, is_booked) VALUES ${placeholders.join(", ")}`,
    values,
  };
}

async function feedSlots({ client, options = {}, now = new Date(), batchSize = 500 } = {}) {
  if (!client) throw new Error("A PostgreSQL client is required.");
  const range = rangeForOptions(options, now);
  const readOnly = Boolean(options.dryRun);
  await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    if (!readOnly) await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);
    const doctorsResult = await client.query("SELECT id FROM doctors ORDER BY id");
    if (doctorsResult.rows.length === 0) throw new Error("No doctors found; create or import doctors before feeding slots.");

    const existingResult = await client.query(
      "SELECT doctor_id, date::text AS date, start_time::text AS start_time FROM doctor_slots WHERE date BETWEEN $1::date AND $2::date",
      [isoDate(range.from), isoDate(range.to)],
    );
    const existing = new Set(existingResult.rows.map(keyOf));
    const candidates = buildCandidates(doctorsResult.rows, range);
    const missing = candidates.filter((candidate) => !existing.has(keyOf(candidate)));

    if (!readOnly) {
      for (let index = 0; index < missing.length; index += batchSize) {
        const query = makeInsertQuery(missing.slice(index, index + batchSize));
        await client.query(query.text, query.values);
      }
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    return { from: isoDate(range.from), to: isoDate(range.to), doctors: doctorsResult.rows.length, existing: existing.size, missing: missing.length, inserted: readOnly ? 0 : missing.length, dryRun: readOnly };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

module.exports = { ADVISORY_LOCK_KEY, DEFAULT_BOOKING_WINDOW_DAYS, buildCandidates, feedSlots, parseOptions, rangeForOptions, slotTimes, validateWindowDays };
