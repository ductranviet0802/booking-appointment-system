// 診察券番号 of P06 (item 22, 更新3) and P07 (item 20, 更新3): one row per active clinic; a confirmed card is read-only and
// never written; new → INSERT (PATIENT, unconfirmed), changed unconfirmed → UPDATE, cleared unconfirmed → DELETE.
// UNIQUE (clinic_id, card_no) (patient_cards_clinic_id_card_no_key) refuses a number another patient holds → PE053.
import type { Prisma } from "@prisma/client";
import { checkCardNo, type FieldError } from "@/lib/auth/validate";
import { prisma } from "@/lib/prisma";

export type CardRow = { clinicId: string; cardNo: string };
export const cardField = (clinicId: string) => `card:${clinicId}`;

/** thrown inside the save transaction: the whole save is refused (P06 7-6, P07 6-4-1) */
export class CardTaken extends Error {
  constructor(public clinicId: string) {
    super("card number taken");
  }
}

export const activeClinics = () =>
  prisma.clinic.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" }, select: { id: true, nameJa: true, nameEn: true, nameVi: true } });

/** null = a value the UI cannot produce (not a list, an unknown / inactive clinic); else the rows and the 4.2 errors */
export function checkCards(raw: unknown, activeIds: string[]): { rows: CardRow[]; errors: FieldError[] } | null {
  if (raw === undefined) return { rows: [], errors: [] };
  if (!Array.isArray(raw)) return null;
  const rows: CardRow[] = [];
  const errors: FieldError[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r.clinicId !== "string" || !activeIds.includes(r.clinicId) || typeof r.cardNo !== "string") return null;
    if (rows.some((x) => x.clinicId === r.clinicId)) return null;
    const error = checkCardNo(r.cardNo, cardField(r.clinicId));
    if (error) errors.push(error);
    rows.push({ clinicId: r.clinicId, cardNo: r.cardNo.trim() });
  }
  return { rows, errors };
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** writes the rows of one patient; call inside the save transaction (a CardTaken rolls everything back) */
export async function writeCards(tx: Prisma.TransactionClient, patientId: string, rows: CardRow[]) {
  for (const row of rows) {
    const key = { patientId_clinicId: { patientId, clinicId: row.clinicId } };
    const card = await tx.patientCard.findUnique({ where: key });
    if (card?.confirmedAt) continue; // read-only once confirmed (S03)
    if (!row.cardNo) {
      if (card) await tx.patientCard.delete({ where: key });
      continue;
    }
    if (card?.cardNo === row.cardNo) continue;
    // 抽出8: held by another patient → PE053 (the message does not say who)
    const other = await tx.patientCard.findFirst({ where: { clinicId: row.clinicId, cardNo: row.cardNo, patientId: { not: patientId } } });
    if (other) throw new CardTaken(row.clinicId);
    try {
      if (card) await tx.patientCard.update({ where: key, data: { cardNo: row.cardNo, enteredByKind: "PATIENT", confirmedAt: null } });
      else await tx.patientCard.create({ data: { patientId, clinicId: row.clinicId, cardNo: row.cardNo, enteredByKind: "PATIENT" } });
    } catch (e) {
      if (isUnique(e)) throw new CardTaken(row.clinicId); // a concurrent save took it between the check and the write
      throw e;
    }
  }
}

/** the rows of a patient for the screen: every active clinic, with its card if any */
export async function cardRows(patientId: string | null) {
  const clinics = await activeClinics();
  const cards = patientId ? await prisma.patientCard.findMany({ where: { patientId } }) : [];
  return clinics.map((c) => {
    const card = cards.find((k) => k.clinicId === c.id);
    return { clinicId: c.id, names: { ja: c.nameJa, en: c.nameEn, vi: c.nameVi }, cardNo: card?.cardNo ?? "", confirmed: !!card?.confirmedAt };
  });
}
export type CardView = Awaited<ReturnType<typeof cardRows>>[number];
