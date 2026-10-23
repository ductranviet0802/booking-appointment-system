// Clinic scope of a staff account (_common 抽出4, F17-02, F18-01) and the re-consent check of a patient (抽出5, F10-02).
import type { Account, Prisma, PrismaClient } from "@prisma/client";
import { dbDate, todayJst } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;
type ScopeAccount = Pick<Account, "id" | "role" | "allClinics">;

export type ConsentKind = "TERMS" | "PRIVACY";
export const CONSENT_KINDS: ConsentKind[] = ["TERMS", "PRIVACY"];

/** 抽出4: the CF-03 choices by clinics.display_order; [] for patients and for staff without any clinic (→ ER-03, SE091) */
export async function staffClinics(account: ScopeAccount, now = new Date(), db: Db = prisma) {
  if (account.role === "PATIENT") return [];
  let where: Prisma.ClinicWhereInput;
  if (account.role === "ADMIN" && account.allClinics) {
    where = { isActive: true };
  } else if (account.role === "DOCTOR") {
    const doctor = await db.doctor.findUnique({ where: { accountId: account.id }, select: { id: true } });
    if (!doctor) return [];
    const today = dbDate(todayJst(now));
    where = {
      OR: [
        { shiftPatterns: { some: { doctorId: doctor.id, OR: [{ validTo: null }, { validTo: { gte: today } }] } } },
        {
          shiftExceptions: {
            some: {
              shiftDate: { gte: today },
              OR: [{ kind: "EXTRA", doctorId: doctor.id }, { kind: "SUBSTITUTE", substituteDoctorId: doctor.id }],
            },
          },
        },
      ],
    };
  } else {
    where = { staffClinics: { some: { accountId: account.id } } };
  }
  return db.clinic.findMany({ where, orderBy: { displayOrder: "asc" }, select: { id: true, code: true, nameJa: true } });
}

/** F17-02 / _common Q8: doctor → clinic of the earliest slots row today (any status), else primary; others → first choice */
export async function initialClinicId(account: ScopeAccount, choices: { id: string }[], now = new Date(), db: Db = prisma) {
  if (account.role === "PATIENT") return null;
  if (account.role === "DOCTOR") {
    const doctor = await db.doctor.findUnique({ where: { accountId: account.id }, select: { id: true, primaryClinicId: true } });
    if (!doctor) return choices[0]?.id ?? null;
    const first = await db.slot.findFirst({
      where: { doctorId: doctor.id, slotDate: dbDate(todayJst(now)) },
      orderBy: { startTime: "asc" },
      select: { clinicId: true },
    });
    return first?.clinicId ?? doctor.primaryClinicId;
  }
  return choices[0]?.id ?? null;
}

/** 抽出5: the current document per kind (latest effective_from ≤ now) of a language */
export async function currentConsentDocuments(language: Account["language"], now = new Date(), db: Db = prisma) {
  const docs = await Promise.all(
    CONSENT_KINDS.map((kind) =>
      db.consentDocument.findFirst({
        where: { kind, language, effectiveFrom: { lte: now } },
        orderBy: { effectiveFrom: "desc" },
        select: { kind: true, version: true, url: true },
      }),
    ),
  );
  return docs.filter((d): d is NonNullable<typeof d> => d !== null);
}

/** F10-02 / _common Q9: kinds whose current version differs from the account's latest agreed version */
export async function pendingConsents(account: Pick<Account, "id" | "role" | "language">, now = new Date(), db: Db = prisma) {
  if (account.role !== "PATIENT") return [];
  const docs = await currentConsentDocuments(account.language, now, db);
  const pending: ConsentKind[] = [];
  for (const doc of docs) {
    const last = await db.consent.findFirst({
      where: { accountId: account.id, kind: doc.kind }, orderBy: { agreedAt: "desc" }, select: { version: true },
    });
    if (last?.version !== doc.version) pending.push(doc.kind as ConsentKind);
  }
  return pending;
}
