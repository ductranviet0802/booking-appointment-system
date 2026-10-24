// S03 開示用データ builder (N-PI-07, S03 更新8): a ZIP of UTF-8 CSV files — profile, 診察券, bookings, 問診 still held,
// notifications, consents — of one patient at ALL clinics of the 法人; no audit entries. Runs after the request committed
// (startDisclosureBuild), sets the BUILDING export_files row DONE (storage key, row count = data rows of all CSVs, sha256,
// +30 days) or FAILED (+30 days). A row A06 already set FAILED (1 hour) stays FAILED and the finished file is discarded (03 §3.28).
// shortcut: the build runs in the web process, unqueued (single instance); a crash leaves BUILDING and A06 sets FAILED after 1 hour.
import { prisma } from "@/lib/prisma";
import { decryptJson, decryptText } from "@/lib/crypto/field";
import { toHhmm, toIsoDate } from "@/lib/datetime";
import { log } from "@/lib/logger";
import { deleteExportFile, storeExportFile } from "@/lib/export/store";
import { zipFiles, type ZipEntry } from "@/lib/export/zip";

const DAYS = 30;
// cap: rows per CSV of one disclosure file (質疑 pending) — over it the build is FAILED (the admin hears SE083), never a cut-off file
export const DISCLOSURE_MAX_ROWS = 20_000;

const iso = (d: Date | null) => (d ? d.toISOString() : "");
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
const csv = (header: string[], rows: string[][]) => `${[header, ...rows].map((r) => r.map(quote).join(",")).join("\r\n")}\r\n`;

/** the CSV files of one patient, name → text (exported for tests) */
export async function disclosureFiles(patientId: string): Promise<Array<{ name: string; text: string; rows: number }>> {
  const p = await prisma.patient.findUniqueOrThrow({ where: { id: patientId } });
  const [cards, bookings, notifications, consents] = await Promise.all([
    prisma.patientCard.findMany({ where: { patientId }, include: { clinic: { select: { code: true, nameJa: true } } }, orderBy: { clinicId: "asc" }, take: DISCLOSURE_MAX_ROWS + 1 }),
    prisma.booking.findMany({
      where: { patientId },
      include: {
        clinic: { select: { code: true, nameJa: true } }, department: { select: { nameJa: true } }, visitType: { select: { nameJa: true } },
        doctor: { select: { familyName: true, givenName: true } }, questionnaire: true,
      },
      orderBy: [{ slotDate: "asc" }, { startTime: "asc" }, { bookingNo: "asc" }], take: DISCLOSURE_MAX_ROWS + 1,
    }),
    prisma.notification.findMany({ where: { patientId }, include: { booking: { select: { bookingNo: true } } }, orderBy: [{ queuedAt: "asc" }, { id: "asc" }], take: DISCLOSURE_MAX_ROWS + 1 }),
    p.accountId ? prisma.consent.findMany({ where: { accountId: p.accountId }, orderBy: [{ agreedAt: "asc" }, { id: "asc" }], take: DISCLOSURE_MAX_ROWS + 1 }) : [],
  ]);
  for (const [name, list] of [["cards", cards], ["bookings", bookings], ["notifications", notifications], ["consents", consents]] as const) {
    if (list.length > DISCLOSURE_MAX_ROWS) throw new Error(`${name}: over the cap ${DISCLOSURE_MAX_ROWS} rows`);
  }
  const held = bookings.filter((b) => b.questionnaire);
  return [
    {
      name: "profile.csv", rows: 1,
      text: csv(
        ["患者ID", "名称区分", "姓", "名", "セイ", "メイ", "生年月日", "性別", "郵便番号", "都道府県", "市区町村", "町域", "番地", "建物名", "電話番号", "SMS受信", "続柄", "作成者", "登録日時", "更新日時"],
        [[p.id, p.nameType, p.familyName, p.givenName, p.familyNameKana, p.givenNameKana, toIsoDate(p.birthDate), p.sex === "MALE" ? "1" : "2", p.postcode, p.prefecture, p.city,
          p.town ?? "", p.addressLine, p.building ?? "", p.phone ?? "", p.smsOptIn ? "1" : "0", p.relation ?? "", p.createdByKind, iso(p.createdAt), iso(p.updatedAt)]],
      ),
    },
    {
      name: "cards.csv", rows: cards.length,
      text: csv(["クリニックコード", "クリニック", "診察券番号", "入力者", "確認日時", "登録日時"],
        cards.map((c) => [c.clinic.code, c.clinic.nameJa, c.cardNo, c.enteredByKind, iso(c.confirmedAt), iso(c.createdAt)])),
    },
    {
      name: "bookings.csv", rows: bookings.length,
      text: csv(
        ["予約番号", "クリニックコード", "クリニック", "予約日", "開始", "終了", "診療科", "診療区分", "医師", "経路", "状態", "料金", "備考", "来院日時", "キャンセル日時", "キャンセル理由", "キャンセル理由(自由記述)", "予約日時"],
        bookings.map((b) => [b.bookingNo, b.clinic.code, b.clinic.nameJa, toIsoDate(b.slotDate), toHhmm(b.startTime), toHhmm(b.endTime), b.department.nameJa, b.visitType.nameJa,
          `${b.doctor.familyName}${b.doctor.givenName}`, b.channel, b.status, b.priceYen === null ? "" : String(b.priceYen), b.notes ? decryptText(b.notes) : "", iso(b.checkedInAt),
          iso(b.canceledAt), b.cancelReasonCode ?? "", b.cancelReasonText ?? "", iso(b.createdAt)]),
      ),
    },
    {
      name: "questionnaires.csv", rows: held.length,
      text: csv(["予約番号", "様式版", "言語", "回答日時", "回答"],
        held.map((b) => [b.bookingNo, b.questionnaire!.formVersion, b.questionnaire!.language, iso(b.questionnaire!.submittedAt), JSON.stringify(decryptJson(b.questionnaire!.answers))])),
    },
    {
      name: "notifications.csv", rows: notifications.length,
      text: csv(["通知種別", "チャネル", "言語", "宛先", "状態", "予約番号", "キュー日時", "送信日時"],
        notifications.map((n) => [n.event, n.channel, n.language, n.toAddress, n.status, n.booking?.bookingNo ?? "", iso(n.queuedAt), iso(n.sentAt)])),
    },
    {
      name: "consents.csv", rows: consents.length,
      text: csv(["種別", "版", "同意日時", "IP"], consents.map((c) => [c.kind, c.version, iso(c.agreedAt), c.ip ?? ""])),
    },
  ];
}

/** builds the ZIP of the BUILDING row `exportFileId` and finishes the row; never throws (the request is long answered) */
export async function buildDisclosure(exportFileId: string, now = new Date()): Promise<"DONE" | "FAILED" | "SKIPPED"> {
  let storageKey: string | null = null;
  try {
    const row = await prisma.exportFile.findUnique({ where: { id: exportFileId } });
    if (!row || row.kind !== "DISCLOSURE" || row.status !== "BUILDING" || !row.patientId) return "SKIPPED";
    const files = await disclosureFiles(row.patientId);
    const zip = zipFiles(files.map((f): ZipEntry => ({ name: f.name, data: Buffer.from(f.text, "utf8") })), now);
    const stored = await storeExportFile(row.fileName, zip);
    storageKey = stored.storageKey;
    const set = await prisma.exportFile.updateMany({
      where: { id: exportFileId, status: "BUILDING" },
      data: {
        status: "DONE", storageKey, sha256: stored.sha256, rowCount: files.reduce((n, f) => n + f.rows, 0), warningCount: 0,
        expiresAt: new Date(Date.now() + DAYS * 86_400_000),
      },
    });
    if (set.count === 1) return "DONE";
    await deleteExportFile(storageKey); // A06 set it FAILED meanwhile (1 hour): the file is discarded
    return "FAILED";
  } catch (e) {
    log("error", "disclosure build failed", { exportFileId, error: e instanceof Error ? e.message : String(e) });
    if (storageKey) await deleteExportFile(storageKey).catch(() => undefined);
    await prisma.exportFile
      .updateMany({ where: { id: exportFileId, status: "BUILDING" }, data: { status: "FAILED", expiresAt: new Date(Date.now() + DAYS * 86_400_000) } })
      .catch(() => undefined);
    return "FAILED";
  }
}

/** called by S03 right after the request committed: starts the build and returns at once */
export function startDisclosureBuild(exportFileId: string) {
  void buildDisclosure(exportFileId);
}
