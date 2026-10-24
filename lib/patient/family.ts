// Server side of P07 家族管理 (events 1, 3, 6, 7, 9). Ownership (F8-01, reading 3): every write that names a member goes
// through requireOwnPatient (route.ts ownPatient) first and is then re-checked inside the transaction under the account
// row lock, so a member detached / deleted meanwhile (or the SELF row, or a merged one) is ER-01 and nothing is written.
import type { Prisma, Relation } from "@prisma/client";
import type { Result } from "@/lib/auth/service";
import { checkPerson, personBody, type FieldError } from "@/lib/auth/validate";
import { dbDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { formatPhone } from "@/lib/public/phone";
import { activeClinics, CardTaken, cardField, cardRows, checkCards, writeCards } from "./cards";
import { formatPostcode, futureReserved, lockAccount } from "./mypage";
import { fail, notOwn, ownPatient, tampered, type Actor } from "./route";

export const RELATIONS = ["CHILD", "SPOUSE", "PARENT", "OTHER"] as const;
const DEFAULT_MAX = 9; // 03 §3.31

/** 抽出1: the members managed by the account (not the holder, not merged into another record) */
const members = (accountId: string): Prisma.PatientWhereInput => ({ accountId, relation: { not: "SELF" }, mergedIntoId: null });

/** 抽出2 */
export async function familyMax(db: Prisma.TransactionClient | typeof prisma = prisma) {
  const row = await db.systemSetting.findUnique({ where: { key: "family_member_max" } });
  const n = Number(row?.value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX;
}

const fieldFail = (errors: FieldError[]): Result => ({ ok: false, status: 400, code: errors[0].code, params: errors[0].params, errors });
const formValues = (p: Parameters<typeof personBody>[0]) => {
  const b = personBody(p);
  const [y, m, d] = b.birthDate.split("-");
  return { ...b, bY: y, bM: String(Number(m)), bD: String(Number(d)), postcode: formatPostcode(b.postcode), phone: p.phone ? formatPhone(p.phone) : "" };
};

// ── event 1 初期表示 (抽出1, 2, 3, 4) ───────────────────────────────────────────────────────────────────────────────

export async function loadFamily(accountId: string, lang: "ja" | "en" | "vi") {
  const [rows, max, holder, clinics] = await Promise.all([
    prisma.patient.findMany({ where: members(accountId), orderBy: { createdAt: "asc" } }),
    familyMax(),
    prisma.patient.findFirstOrThrow({ where: { accountId, relation: "SELF" } }),
    cardRows(null),
  ]);
  return {
    max,
    members: rows.map((p) => ({
      id: p.id, relation: p.relation as Relation, nameType: p.nameType, familyName: p.familyName, givenName: p.givenName,
      birthDate: p.birthDate.toISOString().slice(0, 10),
    })),
    // 抽出4: 姓 and the address of a new member (Q6: name type 日本語氏名, the rest empty)
    prefill: {
      nameType: "JP", familyName: holder.familyName, postcode: formatPostcode(holder.postcode), prefecture: holder.prefecture,
      city: holder.city, town: holder.town ?? "", addressLine: holder.addressLine, building: holder.building ?? "",
    },
    clinics: clinics.map((c) => ({ clinicId: c.clinicId, name: c.names[lang] || c.names.ja })),
  };
}

// ── event 3 「編集」 (抽出1 with the member, 抽出3) ─────────────────────────────────────────────────────────────────

export async function loadMember(a: Actor, patientId: unknown): Promise<Result> {
  if (!(await ownPatient(patientId))) return notOwn();
  const p = await prisma.patient.findFirst({ where: { id: patientId as string, ...members(a.accountId) } });
  if (!p) return notOwn(); // the SELF row or a merged one is not a member (3-2)
  const cards = await cardRows(p.id);
  return {
    ok: true,
    body: {
      member: {
        id: p.id, relation: p.relation, values: formValues(p),
        cards: cards.map((c) => ({ clinicId: c.clinicId, cardNo: c.cardNo, confirmed: c.confirmed })),
      },
    },
  };
}

// ── event 6 保存する ─────────────────────────────────────────────────────────────────────────────────────────────

class NotOwn extends Error {}
class Limit extends Error {}
class Duplicate extends Error {}

/** body: { patientId? (edit), relation, …person, cards: [{ clinicId, cardNo }] }; no patientId = add */
export async function saveMember(a: Actor, body: Record<string, unknown>): Promise<Result> {
  const edit = body.patientId !== undefined && body.patientId !== null && body.patientId !== "";
  if (edit && !(await ownPatient(body.patientId))) return notOwn(); // 6-6: before any check, nothing written
  const person = checkPerson(body, a.now, false);
  const relation = body.relation;
  const clinics = await activeClinics();
  const cards = checkCards(body.cards, clinics.map((c) => c.id));
  const relationOk = relation === "" || relation === undefined || RELATIONS.includes(relation as (typeof RELATIONS)[number]);
  if (!person || !cards || !relationOk) return tampered(); // SELF or an unknown relation / clinic → ER-02
  const errors: FieldError[] = [];
  if (!relation) errors.push({ field: "relation", code: "PE001" });
  errors.push(...person.errors, ...cards.errors);
  if (errors.length) return fieldFail(errors); // 6-4: nothing written

  const data = { ...person.input, birthDate: dbDate(person.input.birthDate), relation: relation as Relation };
  const max = await familyMax();
  try {
    await prisma.$transaction(async (tx) => {
      await lockAccount(tx, a.accountId); // serialises adds of one account: the limit and the duplicate check hold
      const id = edit ? String(body.patientId) : null;
      if (id) {
        if (!(await tx.patient.count({ where: { id, ...members(a.accountId) } }))) throw new NotOwn();
      } else if ((await tx.patient.count({ where: members(a.accountId) })) >= max) throw new Limit(); // 6-5
      // 6-1 (v0.3): the same person is not registered twice under one account — same name and date of birth
      const same = await tx.patient.count({
        where: {
          accountId: a.accountId, mergedIntoId: null, birthDate: data.birthDate, ...(id && { id: { not: id } }),
          familyName: { equals: data.familyName, mode: "insensitive" }, givenName: { equals: data.givenName, mode: "insensitive" },
        },
      });
      if (same) throw new Duplicate();
      const saved = id
        ? await tx.patient.update({ where: { id }, data }) // 更新2
        : await tx.patient.create({ data: { ...data, accountId: a.accountId, createdByKind: "PATIENT" } }); // 更新1
      await writeCards(tx, saved.id, cards.rows); // 更新3
    });
  } catch (e) {
    if (e instanceof NotOwn) return notOwn();
    if (e instanceof Limit) return fail(409, "PE046", { n: max });
    if (e instanceof Duplicate) return fieldFail([{ field: "familyName", code: "DUP_MEMBER" }]);
    if (e instanceof CardTaken) return fieldFail([{ field: cardField(e.clinicId), code: "PE053" }]);
    throw e;
  }
  return { ok: true, body: { code: "PI042" } };
}

// ── events 7 / 9 削除 ───────────────────────────────────────────────────────────────────────────────────────────

const futureOf = (db: Prisma.TransactionClient | typeof prisma, patientId: string, now: Date) =>
  db.booking.count({ where: { patientId, ...futureReserved(now) } });

/** event 7: PE043 when the member has a future RESERVED booking, else ok (the dialog opens) */
export async function checkDelete(a: Actor, patientId: unknown): Promise<Result> {
  if (!(await ownPatient(patientId))) return notOwn();
  if (!(await prisma.patient.count({ where: { id: patientId as string, ...members(a.accountId) } }))) return notOwn();
  return (await futureOf(prisma, patientId as string, a.now)) ? fail(409, "PE043") : { ok: true, body: {} };
}

class Blocked extends Error {}

/** event 9: never booked → DELETE (更新4); booked before → detach (更新5); a future RESERVED booking → PE043 (9-3) */
export async function deleteMember(a: Actor, patientId: unknown): Promise<Result> {
  if (!(await ownPatient(patientId))) return notOwn();
  const id = patientId as string;
  try {
    const kind = await prisma.$transaction(async (tx) => {
      await lockAccount(tx, a.accountId);
      if (!(await tx.patient.count({ where: { id, ...members(a.accountId) } }))) throw new NotOwn(); // 9-4
      if (await futureOf(tx, id, a.now)) throw new Blocked();
      // rows that keep the record (03 §0): bookings of any status; notifications / export files also reference it
      const history = (await tx.booking.count({ where: { patientId: id } }))
        + (await tx.notification.count({ where: { patientId: id } })) + (await tx.exportFile.count({ where: { patientId: id } }));
      if (history) {
        await tx.patient.update({ where: { id }, data: { accountId: null } }); // relation kept (Q11)
        return "detached" as const;
      }
      await tx.patientCard.deleteMany({ where: { patientId: id } });
      await tx.patient.delete({ where: { id } });
      return "deleted" as const;
    });
    return { ok: true, body: { code: "PI047", result: kind } };
  } catch (e) {
    if (e instanceof NotOwn) return notOwn();
    if (e instanceof Blocked) return fail(409, "PE043");
    throw e;
  }
}
