// spec-screen: S02
// 代理予約 server side: patient search (抽出1), selection + PATIENT_VIEW audit (event 12), the master lists and the frame grid
// (抽出3–5, events 1, 6), and the confirmation (event 10) in ONE transaction: new patient + 診察券 + the booking core
// (bookInTx) + BOOKING_UPDATE audit. SW020 / SW021 are answered from inside that transaction, which is then rolled back.
import { Prisma } from "@prisma/client";
import { bad, done, fail, isUuid, type Actor } from "@/lib/admin/common";
import { audit, type Result } from "@/lib/auth/service";
import { bookInTx, STAFF_CODE, type BookingInput } from "@/lib/booking/core";
import { deliverAfterCommit, recipientOf } from "@/lib/booking/notify";
import { policyOf } from "@/lib/booking/policy";
import { decryptText } from "@/lib/crypto/field";
import { addDays, dbDate, toHhmm, toIsoDate, todayJst } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/public/phone";
import { checkBookingFields, checkNewPatient, checkSearch, isoOf, type FErr } from "./proxy-rules";

type Db = Prisma.TransactionClient;
// cap: patient search result rows: the spec states it (7 / SI034): 100, the 101st only decides SI034
export const SEARCH_MAX = 100;

class Abort {
  constructor(public result: Result) {}
}
const fieldErrors = (errors: FErr[]): Result => ({ ok: false, status: 400, code: errors[0].code, params: errors[0].params, errors });
const ymd = (d: Date) => toIsoDate(d).replace(/-/g, "/");

export type PatientSummary = { id: string; name: string; kana: string; birth: string; age: number; card: string | null; target: string };

const TARGET = { MAIL: "メール（Web会員）", SMS: "SMS", LINE: "LINE（Web会員）" } as const;
/** 抽出7 / Q9: the label of the notification target, from the same rule the core uses to queue the notice */
export async function targetOf(db: Db | typeof prisma, patientId: string) {
  const r = await recipientOf(patientId, db);
  return r ? TARGET[r.channel] : "なし";
}
const ageOf = (birth: Date, today: string) => {
  const b = toIsoDate(birth);
  return Number(today.slice(0, 4)) - Number(b.slice(0, 4)) - (today.slice(5) < b.slice(5) ? 1 : 0);
};

async function summaryOf(a: Actor, patientId: string): Promise<PatientSummary | null> {
  const p = await prisma.patient.findUnique({ where: { id: patientId }, include: { cards: { where: { clinicId: a.clinicId } } } });
  if (!p || p.mergedIntoId || p.anonymizedAt) return null;
  return {
    id: p.id, name: `${p.familyName} ${p.givenName}`, kana: `${p.familyNameKana} ${p.givenNameKana}`, birth: ymd(p.birthDate),
    age: ageOf(p.birthDate, todayJst(a.now)), card: p.cards[0]?.cardNo ?? null, target: await targetOf(prisma, p.id),
  };
}

// ── event 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function searchPatients(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const { errors, input } = checkSearch(body);
  if (errors.length) return fieldErrors(errors);
  const and: Prisma.PatientWhereInput[] = input.kana.map((w) => ({ OR: [{ familyNameKana: { contains: w } }, { givenNameKana: { contains: w } }] }));
  if (input.phone) and.push({ phone: input.phone });
  if (input.card) and.push({ cards: { some: { clinicId: a.clinicId, cardNo: input.card } } });
  if (input.bookingNo) and.push({ bookings: { some: { bookingNo: input.bookingNo } } });
  const found = await prisma.patient.findMany({
    where: { mergedIntoId: null, anonymizedAt: null, AND: and }, take: SEARCH_MAX + 1,
    orderBy: [{ familyNameKana: "asc" }, { givenNameKana: "asc" }, { birthDate: "asc" }],
    include: { cards: { where: { clinicId: a.clinicId } } },
  });
  const rows = found.slice(0, SEARCH_MAX).map((p) => ({
    id: p.id, name: `${p.familyName} ${p.givenName}`, kana: `${p.familyNameKana} ${p.givenNameKana}`, birth: ymd(p.birthDate),
    phone: p.phone ? formatPhone(p.phone) : "", card: p.cards[0]?.cardNo ?? "", web: !!p.accountId,
  }));
  return done({ rows, more: found.length > SEARCH_MAX });
}

// ── event 12 ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function selectPatient(a: Actor, body: Record<string, unknown>): Promise<Result> {
  if (!isUuid(body.patientId)) return bad();
  const summary = await summaryOf(a, body.patientId);
  if (!summary) return bad();
  await audit(prisma, { accountId: a.accountId, role: a.role, action: "PATIENT_VIEW", ip: a.ip, now: a.now, targetType: "patient", targetId: summary.id, clinicId: a.clinicId });
  return done({ patient: summary });
}

// ── opening (events 1, T084, change mode) ───────────────────────────────────────────────────────────────────────────

export type Preset = {
  clinicName: string; today: string; windowDays: number; departments: Array<{ id: string; name: string }>; date: string;
  patient: PatientSummary | null;
  change: null | {
    bookingId: string; bookingNo: string; version: number; date: string; start: string; end: string; departmentId: string; visitTypeId: string;
    doctorId: string; channel: "PHONE" | "COUNTER"; notes: string;
  };
};
export type OpenFail = "ER02" | "ER03";

/** 1-1 … 1-6; a booking of another clinic → ER-03, unknown / not RESERVED / merged → ER-02 */
export async function loadPreset(a: Actor, q: { date?: string; bookingId?: string; patientId?: string }): Promise<Preset | OpenFail> {
  const today = todayJst(a.now);
  const [clinic, departments, policy] = await Promise.all([
    prisma.clinic.findUniqueOrThrow({ where: { id: a.clinicId }, select: { nameJa: true } }),
    prisma.clinicDepartment.findMany({ where: { clinicId: a.clinicId, department: { isActive: true } }, orderBy: { displayOrder: "asc" }, include: { department: true } }),
    policyOf(a.clinicId),
  ]);
  const out: Preset = {
    clinicName: clinic.nameJa, today, windowDays: policy.bookingWindowDays, departments: departments.map((d) => ({ id: d.departmentId, name: d.department.nameJa })),
    date: q.date && isoOf(q.date) && toIsoDate(dbDate(isoOf(q.date))) === isoOf(q.date) ? isoOf(q.date) : today, patient: null, change: null,
  };
  if (q.bookingId !== undefined) {
    if (!isUuid(q.bookingId)) return "ER02";
    const b = await prisma.booking.findUnique({ where: { id: q.bookingId } });
    if (!b) return "ER02";
    if (b.clinicId !== a.clinicId) return "ER03";
    if (b.status !== "RESERVED") return "ER02";
    out.patient = await summaryOf(a, b.patientId);
    if (!out.patient) return "ER02";
    out.date = toIsoDate(b.slotDate);
    out.change = {
      bookingId: b.id, bookingNo: b.bookingNo, version: b.version, date: out.date, start: toHhmm(b.startTime), end: toHhmm(b.endTime),
      departmentId: b.departmentId, visitTypeId: b.visitTypeId, doctorId: b.doctorRequested ? b.doctorId : "",
      channel: b.channel === "COUNTER" ? "COUNTER" : "PHONE", notes: b.notes ? decryptText(b.notes) : "", // Q10 a: editable, so start from the stored text (an empty box would erase it)
    };
  } else if (q.patientId !== undefined) {
    if (!isUuid(q.patientId)) return "ER02";
    out.patient = await summaryOf(a, q.patientId);
    if (!out.patient) return "ER02";
  }
  return out;
}

// ── events 1, 6, 7: lists and grid ──────────────────────────────────────────────────────────────────────────────────

export type GridCell = { start: string; end: string; state: "free" | "full" | "closed" };
export type Options = {
  visitTypes: Array<{ id: string; name: string; frames: number; minutes: number }>;
  doctors: Array<{ id: string; label: string }>; doctorId: string;
  grid: null | { times: string[]; columns: Array<{ id: string; label: string; cells: GridCell[] }> };
  notice: null | { code: "SE022" | "SE023"; params?: Record<string, number> };
};

export async function loadOptions(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const departmentId = body.departmentId;
  const empty: Options = { visitTypes: [], doctors: [], doctorId: "", grid: null, notice: null };
  if (departmentId === undefined || departmentId === "") return done({ options: empty });
  if (!isUuid(departmentId) || !(await prisma.clinicDepartment.count({ where: { clinicId: a.clinicId, departmentId, department: { isActive: true } } }))) return bad();
  const policy = await policyOf(a.clinicId);
  const types = await prisma.visitType.findMany({ where: { clinicId: a.clinicId, departmentId, isActive: true }, orderBy: { displayOrder: "asc" } });
  const options: Options = {
    ...empty, visitTypes: types.map((v) => ({ id: v.id, name: v.nameJa, frames: v.durationFrames, minutes: v.durationFrames * policy.frameMinutes })), // staff-only types included
  };
  const date = typeof body.date === "string" ? isoOf(body.date) : "";
  if (!date || toIsoDate(dbDate(date)) !== date) return fail(400, "SE002", { 項目: "予約日" });
  const today = todayJst(a.now);
  if (date < today || date > addDays(today, policy.bookingWindowDays)) { // Q5 a: a past date is SE022 too
    return done({ options: { ...options, notice: { code: "SE022", params: { n: policy.bookingWindowDays } } } });
  }
  const own = isUuid(body.bookingId)
    ? (await prisma.bookingSlot.findMany({ where: { bookingId: body.bookingId, booking: { clinicId: a.clinicId } }, select: { slotId: true } })).map((s) => s.slotId)
    : [];
  const slots = await prisma.slot.findMany({
    where: { clinicId: a.clinicId, departmentId, slotDate: dbDate(date), doctor: { isActive: true } },
    include: { doctor: true }, orderBy: { startTime: "asc" },
  });
  if (slots.length === 0 || slots.every((s) => s.status === "CLOSED")) {
    return done({ options: { ...options, notice: { code: "SE023" } } }); // Q5 b: no frame at all reads as closed
  }
  const doctors = new Map<string, (typeof slots)[number]["doctor"]>();
  for (const s of slots) if (s.status === "OPEN") doctors.set(s.doctorId, s.doctor);
  const list = [...doctors.values()].sort((x, y) => x.displayOrder - y.displayOrder);
  options.doctors = list.map((d) => ({ id: d.id, label: `${d.familyName} ${d.givenName}` }));
  const named = typeof body.doctorId === "string" && list.some((d) => d.id === body.doctorId) ? body.doctorId : ""; // Q4 d: back to 指名なし
  options.doctorId = named;
  const shown = named ? list.filter((d) => d.id === named) : list;
  const times = [...new Set(slots.filter((s) => shown.some((d) => d.id === s.doctorId)).map((s) => toHhmm(s.startTime)))].sort();
  options.grid = {
    times,
    columns: shown.map((d) => ({
      id: d.id, label: `${d.familyName} ${d.givenName}`,
      cells: slots.filter((s) => s.doctorId === d.id).map((s): GridCell => ({
        start: toHhmm(s.startTime), end: toHhmm(s.endTime),
        state: s.status === "CLOSED" ? "closed" : s.reservedCount - (own.includes(s.id) ? 1 : 0) >= s.capacity ? "full" : "free", // own frames are free (F5-01)
      })),
    })),
  };
  return done({ options });
}

// ── event 10 ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function confirmBooking(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const change = body.bookingId !== undefined && body.bookingId !== null;
  if (change && (!isUuid(body.bookingId) || !Number.isInteger(body.version))) return bad();
  const channel = body.channel;
  if (channel !== "" && channel !== undefined && channel !== "PHONE" && channel !== "COUNTER") return bad();
  const newForm = body.newPatient && typeof body.newPatient === "object" ? (body.newPatient as Record<string, unknown>) : null;
  const errors: FErr[] = [];
  let np = null;
  if (newForm && !change) {
    const c = checkNewPatient(newForm, a.now);
    if (c.tampered) return bad();
    errors.push(...c.errors);
    np = c.input;
  } else if (!change && !isUuid(body.patientId)) return bad();
  errors.push(...checkBookingFields(body));
  if (errors.length) return fieldErrors(errors);

  const date = isoOf(body.date);
  const startTime = String(body.startTime);
  if (toIsoDate(dbDate(date)) !== date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) return bad();
  const notes = typeof body.notes === "string" && body.notes.replace(/[\s　]/g, "") !== "" ? body.notes : null;
  const doctorSel = body.doctorSel === undefined || body.doctorSel === "" ? "" : body.doctorSel;
  if ((doctorSel !== "" && !isUuid(doctorSel)) || !isUuid(body.doctorId) || (doctorSel !== "" && doctorSel !== body.doctorId)) return bad();

  const staff = { kind: "STAFF" as const, accountId: a.accountId, channel: channel as "PHONE" | "COUNTER" };
  const out = await prisma
    .$transaction(async (tx) => {
      let patientId = typeof body.patientId === "string" ? body.patientId : "";
      let departmentId = String(body.departmentId);
      let visitTypeId = String(body.visitTypeId);
      let old: Awaited<ReturnType<typeof tx.booking.findUnique>> = null;
      if (change) {
        old = await tx.booking.findUnique({ where: { id: body.bookingId as string } });
        if (!old) throw new Abort(bad());
        if (old.clinicId !== a.clinicId) throw new Abort(fail(403, "SE091"));
        [patientId, departmentId, visitTypeId] = [old.patientId, old.departmentId, old.visitTypeId]; // fixed in change mode (F5-01)
        if (old.status !== "RESERVED") throw new Abort(fail(409, "SE010")); // 10-7
      } else if (!np) {
        const p = await tx.patient.findUnique({ where: { id: patientId }, select: { mergedIntoId: true, anonymizedAt: true } });
        if (!p || p.mergedIntoId || p.anonymizedAt) throw new Abort(bad());
      }
      // values the UI cannot produce → ER-02 (Q17); a master deactivated meanwhile is left to the core (SE020)
      const [dept, vt, doc] = await Promise.all([
        tx.clinicDepartment.count({ where: { clinicId: a.clinicId, departmentId } }),
        tx.visitType.count({ where: { id: visitTypeId, clinicId: a.clinicId, departmentId } }),
        tx.doctorDepartment.count({ where: { doctorId: body.doctorId as string, departmentId } }),
      ]);
      if (!dept || !vt || !doc) throw new Abort(bad());

      if (np) {
        if (np.cardNo && (await tx.patientCard.count({ where: { clinicId: a.clinicId, cardNo: np.cardNo } }))) throw new Abort(fail(409, "SE030")); // Q14
        const created = await tx.patient.create({
          data: {
            accountId: null, relation: null, nameType: np.nameType, familyName: np.familyName, givenName: np.givenName, familyNameKana: np.familyNameKana,
            givenNameKana: np.givenNameKana, birthDate: dbDate(np.birthDate), sex: np.sex, postcode: np.postcode, prefecture: np.prefecture, city: np.city,
            town: np.town, addressLine: np.addressLine, building: np.building, phone: np.phone, smsOptIn: np.smsOptIn, createdByKind: "STAFF",
          },
        });
        patientId = created.id;
        if (np.cardNo) {
          await tx.patientCard.create({ data: { patientId, clinicId: a.clinicId, cardNo: np.cardNo, enteredByKind: "STAFF", confirmedAt: a.now } });
        }
      }

      const input: BookingInput = {
        clinicId: a.clinicId, departmentId, visitTypeId, patientId, doctorId: body.doctorId as string, doctorRequested: doctorSel !== "",
        slotDate: date, startTime, notes,
      };
      // F4-04: a doctor-only reassignment of a 指名なし booking (same day and time) sends no NT-03
      const notify = !(old && !old.doctorRequested && !input.doctorRequested && toIsoDate(old.slotDate) === date && toHhmm(old.startTime) === startTime);
      const r = await bookInTx(tx, input, staff, { overrideLimit: body.overrideLimit === true, notify, now: a.now }, old ? { bookingId: old.id, version: body.version as number } : undefined);
      if (!r.ok) {
        if (r.rule === "LIMIT") throw new Abort(done({ dialog: "SW020", nos: r.sameDayBookingNos ?? [] }));
        const params = r.rule === "WINDOW" || r.rule === "CUTOFF" ? { n: (await policyOf(a.clinicId, tx)).bookingWindowDays } : undefined;
        throw new Abort(fail(409, STAFF_CODE[r.rule], params));
      }
      if (notify && !r.notificationId && body.ackNoTarget !== true) throw new Abort(done({ dialog: "SW021" })); // 9-1: nothing written yet
      await audit(tx, {
        accountId: a.accountId, role: a.role, action: "BOOKING_UPDATE", ip: a.ip, now: a.now, targetType: "booking", targetId: r.bookingId,
        clinicId: a.clinicId, detail: { event: old ? "CHANGED" : "CREATED" },
      });
      return { r, changed: !!old };
    }, { timeout: 15_000 })
    .catch((e) => {
      if (e instanceof Abort) return e.result;
      if ((e as { code?: string })?.code === "P2002") return fail(409, "SE030"); // two clerks entering one 診察券番号
      throw e;
    });
  if ("ok" in out) return out;
  await deliverAfterCommit([out.r.notificationId]);
  return done({ bookingNo: out.r.bookingNo, date, changed: out.changed });
}
