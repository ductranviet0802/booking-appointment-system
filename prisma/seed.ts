// Demo seed for ver1 (N-DATA-02: every row satisfies the ver1 rules). Wipes every table first.
// Run: node bin/run-ts.mjs prisma/seed.ts   (npm run seed)
import "dotenv/config";
import bcrypt from "bcrypt";
import type { Band, Prisma } from "@prisma/client";
import { pool, prisma } from "@/lib/prisma";
import { addDays, dbDate, dbTime, todayJst, toIsoDate, weekdayOf } from "@/lib/datetime";
import { fetchHolidayFile, parseHolidayCsv } from "@/lib/adapters/x3-holidays";
import { runJob } from "@/lib/batch/runner";
import { encryptJson, encryptText } from "@/lib/crypto/field";
import { storeExportFile } from "@/lib/export/store";
import { defaultTemplateRows } from "@/lib/notify/templates-default";
import { SEED_ACCOUNTS, SEED_PASSWORD } from "./seed-accounts";

const today = todayJst();
const PAST_DAYS = 14; // frames before today, so past bookings have real frames

type BandHours = { open: string; close: string; reception: string };
type ClinicSeed = {
  code: string;
  data: Omit<Prisma.ClinicCreateManyInput, "code" | "displayOrder">;
  bands: Record<Band, BandHours>;
  open: Record<number, Band[]>; // weekday → open bands
  departments: string[];
};

const CLINICS: ClinicSeed[] = [
  {
    code: "honin",
    data: {
      nameJa: "たなか内科クリニック 本院", nameEn: "Tanaka Clinic Main", nameVi: "Phòng khám Tanaka Cơ sở chính",
      nameKana: "タナカナイカクリニック ホンイン", postcode: "1000005", prefecture: "東京都", city: "千代田区",
      addressLine: "丸の内1-2-3 丸の内中央ビル2階", addressEn: "2F Marunouchi Chuo Bldg., 1-2-3 Marunouchi, Chiyoda-ku, Tokyo",
      phone: "0312345678",
      accessJa: "JR東京駅 丸の内北口 徒歩3分。駐車場はありません（近隣のコインパーキングをご利用ください）。",
      accessEn: "3 min walk from JR Tokyo Station, Marunouchi North Exit. No parking (please use a nearby coin parking).",
      accessVi: "Đi bộ 3 phút từ cửa Bắc Marunouchi, ga JR Tokyo. Không có bãi đỗ xe.",
      mapUrl: "https://maps.google.com/?q=%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%8D%83%E4%BB%A3%E7%94%B0%E5%8C%BA%E4%B8%B8%E3%81%AE%E5%86%851-2-3",
      noticeJa: "院内研修のため臨時休診日があります。休診日・臨時診療の一覧をご確認ください。",
      noticeEn: "The clinic is closed on some days for staff training. Please check the list of closed days.",
      noticeVi: "Phòng khám nghỉ một số ngày để đào tạo nhân viên. Vui lòng xem danh sách ngày nghỉ.",
    },
    bands: { AM: { open: "09:00", close: "12:00", reception: "11:30" }, PM: { open: "15:00", close: "18:00", reception: "17:30" } },
    open: { 1: ["AM", "PM"], 2: ["AM", "PM"], 3: ["AM"], 4: ["AM", "PM"], 5: ["AM", "PM"], 6: ["AM"] },
    departments: ["naika", "shonika", "hifuka"],
  },
  {
    code: "ekimae",
    data: {
      nameJa: "たなか内科クリニック 駅前院", nameEn: "Tanaka Clinic Ekimae", nameVi: "Phòng khám Tanaka Cơ sở Ekimae",
      nameKana: "タナカナイカクリニック エキマエイン", postcode: "1600022", prefecture: "東京都", city: "新宿区",
      addressLine: "新宿3-4-5 駅前ビル5階", addressEn: "5F Ekimae Bldg., 3-4-5 Shinjuku, Shinjuku-ku, Tokyo",
      phone: "0323456789",
      accessJa: "JR新宿駅 東口 徒歩2分。提携駐車場はありません。",
      accessEn: "2 min walk from JR Shinjuku Station, East Exit. No partner parking.",
      accessVi: "Đi bộ 2 phút từ cửa Đông, ga JR Shinjuku. Không có bãi đỗ xe liên kết.",
    },
    bands: { AM: { open: "09:30", close: "12:30", reception: "12:00" }, PM: { open: "14:30", close: "18:30", reception: "18:00" } },
    open: { 1: ["AM", "PM"], 2: ["AM", "PM"], 3: ["AM", "PM"], 4: ["AM"], 5: ["AM", "PM"], 6: ["AM"] },
    departments: ["naika", "hifuka"],
  },
  {
    code: "nishiguchi",
    data: {
      nameJa: "たなか内科クリニック 西口院", nameEn: "Tanaka Clinic Nishiguchi", nameVi: "Phòng khám Tanaka Cơ sở Nishiguchi",
      nameKana: "タナカナイカクリニック ニシグチイン", postcode: "1710021", prefecture: "東京都", city: "豊島区",
      addressLine: "西池袋1-6-7", addressEn: "1-6-7 Nishi-Ikebukuro, Toshima-ku, Tokyo",
      phone: "0334567890",
      accessJa: "池袋駅 西口 徒歩5分。駐車場2台あり。",
      accessEn: "5 min walk from Ikebukuro Station, West Exit. Parking for 2 cars.",
      accessVi: "Đi bộ 5 phút từ cửa Tây, ga Ikebukuro. Có chỗ đỗ cho 2 xe.",
    },
    bands: { AM: { open: "09:00", close: "12:00", reception: "11:30" }, PM: { open: "15:00", close: "18:00", reception: "17:30" } },
    open: { 1: ["AM", "PM"], 2: ["AM", "PM"], 3: ["AM"], 4: ["AM", "PM"], 5: ["AM", "PM"], 6: ["AM"] },
    departments: ["naika", "shonika", "hifuka"],
  },
];

const DEPARTMENTS = [
  { code: "naika", nameJa: "内科", nameEn: "Internal Medicine", nameVi: "Nội khoa", nameKana: "ナイカ", displayOrder: 1 },
  { code: "shonika", nameJa: "小児科", nameEn: "Pediatrics", nameVi: "Nhi khoa", nameKana: "ショウニカ", displayOrder: 2 },
  { code: "hifuka", nameJa: "皮膚科", nameEn: "Dermatology", nameVi: "Da liễu", nameKana: "ヒフカ", displayOrder: 3 },
];
const DEPT_PREFIX: Record<string, string> = { naika: "N", shonika: "S", hifuka: "H" };

type Shift = { clinic: string; dept: string; weekdays: number[]; bands: Band[] };
const DOCTORS: Array<Omit<Prisma.DoctorCreateManyInput, "primaryClinicId" | "displayOrder" | "profileJa"> & {
  primary: string;
  depts: string[];
  shifts: Shift[];
  profileJa: string;
}> = [
  {
    code: "D001", familyName: "田中", givenName: "誠", familyNameKana: "タナカ", givenNameKana: "マコト", nameRomaji: "Makoto Tanaka",
    title: "DIRECTOR", languages: ["ja", "en"], primary: "honin", depts: ["naika"],
    profileJa: "大学病院 消化器内科を経て、2018年より当院院長。", profileEn: "Director since 2018, after the gastroenterology department of a university hospital.",
    profileVi: "Giám đốc phòng khám từ năm 2018, sau thời gian công tác tại khoa tiêu hóa của một bệnh viện đại học.",
    qualificationsJa: "日本内科学会 総合内科専門医", qualificationsEn: "Fellow of the Japanese Society of Internal Medicine (general internal medicine)",
    qualificationsVi: "Bác sĩ chuyên khoa nội tổng quát, Hội Nội khoa Nhật Bản",
    shifts: [{ clinic: "honin", dept: "naika", weekdays: [1, 2, 4, 5], bands: ["AM", "PM"] }, { clinic: "honin", dept: "naika", weekdays: [6], bands: ["AM"] }],
  },
  {
    code: "D002", familyName: "高橋", givenName: "由美", familyNameKana: "タカハシ", givenNameKana: "ユミ", nameRomaji: "Yumi Takahashi",
    title: "DOCTOR", languages: ["ja"], primary: "honin", depts: ["naika"],
    profileJa: "総合病院 内科勤務を経て、2020年より当院勤務。", profileEn: "At the clinic since 2020, after internal medicine at a general hospital.",
    profileVi: "Làm việc tại phòng khám từ năm 2020, sau thời gian công tác tại khoa nội của một bệnh viện đa khoa.",
    shifts: [
      { clinic: "honin", dept: "naika", weekdays: [1, 3], bands: ["AM"] },
      { clinic: "ekimae", dept: "naika", weekdays: [2, 4], bands: ["AM"] },
      { clinic: "ekimae", dept: "naika", weekdays: [5], bands: ["PM"] },
    ],
  },
  {
    code: "D003", familyName: "佐藤", givenName: "健一", familyNameKana: "サトウ", givenNameKana: "ケンイチ", nameRomaji: "Kenichi Sato",
    title: "VICE_DIRECTOR", languages: ["ja"], primary: "honin", depts: ["shonika"],
    profileJa: "小児科専門医。こども病院勤務を経て、2019年より副院長。", qualificationsJa: "日本小児科学会 小児科専門医",
    profileEn: "Board-certified pediatrician. Vice director since 2019, after a children's hospital.",
    profileVi: "Bác sĩ chuyên khoa nhi. Phó giám đốc từ năm 2019, sau thời gian công tác tại một bệnh viện nhi.",
    qualificationsEn: "Board-certified pediatrician, Japan Pediatric Society", qualificationsVi: "Bác sĩ chuyên khoa nhi, Hội Nhi khoa Nhật Bản",
    shifts: [{ clinic: "honin", dept: "shonika", weekdays: [1, 2, 4, 5], bands: ["AM", "PM"] }],
  },
  {
    code: "D004", familyName: "松本", givenName: "亮", familyNameKana: "マツモト", givenNameKana: "リョウ", nameRomaji: "Ryo Matsumoto",
    title: "DOCTOR", languages: ["ja"], primary: "nishiguchi", depts: ["shonika"],
    profileJa: "小児科医。地域の小児医療に携わる。", profileEn: "Pediatrician working in community child health.",
    profileVi: "Bác sĩ nhi khoa, tham gia chăm sóc sức khỏe trẻ em tại địa phương.",
    shifts: [
      { clinic: "honin", dept: "shonika", weekdays: [3, 6], bands: ["AM"] },
      { clinic: "nishiguchi", dept: "shonika", weekdays: [1, 2], bands: ["AM", "PM"] },
    ],
  },
  {
    code: "D005", familyName: "渡辺", givenName: "隆", familyNameKana: "ワタナベ", givenNameKana: "タカシ", nameRomaji: "Takashi Watanabe",
    title: "DOCTOR", languages: ["ja", "en"], primary: "ekimae", depts: ["hifuka"],
    profileJa: "皮膚科専門医。アトピー性皮膚炎の診療に従事。", qualificationsJa: "日本皮膚科学会 皮膚科専門医",
    profileEn: "Board-certified dermatologist treating atopic dermatitis.", profileVi: "Bác sĩ chuyên khoa da liễu, điều trị viêm da cơ địa.",
    qualificationsEn: "Board-certified dermatologist, Japanese Dermatological Association", qualificationsVi: "Bác sĩ chuyên khoa da liễu, Hội Da liễu Nhật Bản",
    shifts: [
      { clinic: "ekimae", dept: "hifuka", weekdays: [1, 3], bands: ["AM", "PM"] },
      { clinic: "ekimae", dept: "hifuka", weekdays: [5], bands: ["AM"] },
    ],
  },
  {
    code: "D006", familyName: "伊藤", givenName: "真理", familyNameKana: "イトウ", givenNameKana: "マリ", nameRomaji: "Mari Ito",
    title: "PART_TIME", languages: ["ja", "vi"], primary: "nishiguchi", depts: ["hifuka"],
    profileJa: "非常勤の皮膚科医。ベトナム語で診療できます。", profileVi: "Bác sĩ da liễu bán thời gian. Có thể khám bằng tiếng Việt.",
    profileEn: "Part-time dermatologist. Consultations in Vietnamese are available.",
    shifts: [
      { clinic: "nishiguchi", dept: "hifuka", weekdays: [4], bands: ["AM", "PM"] },
      { clinic: "nishiguchi", dept: "hifuka", weekdays: [5], bands: ["AM"] },
      { clinic: "honin", dept: "hifuka", weekdays: [2], bands: ["PM"] },
    ],
  },
  {
    code: "D007", familyName: "小林", givenName: "直樹", familyNameKana: "コバヤシ", givenNameKana: "ナオキ", nameRomaji: "Naoki Kobayashi",
    title: "DOCTOR", languages: ["ja", "en"], primary: "nishiguchi", depts: ["naika"],
    profileJa: "内科医。生活習慣病の診療に従事。", profileEn: "Internist treating lifestyle-related diseases.",
    profileVi: "Bác sĩ nội khoa, điều trị các bệnh liên quan đến lối sống.",
    shifts: [
      { clinic: "nishiguchi", dept: "naika", weekdays: [1, 2, 3, 4, 5], bands: ["AM"] },
      { clinic: "ekimae", dept: "naika", weekdays: [1], bands: ["PM"] },
    ],
  },
];

const VISIT_NOTICE_FIRST = {
  noticeJa: "保険証またはマイナ保険証をお持ちください。紹介状をお持ちの方はご持参ください。",
  noticeEn: "Please bring your health insurance card or My Number insurance card, and a referral letter if you have one.",
  noticeVi: "Vui lòng mang theo thẻ bảo hiểm y tế hoặc thẻ My Number, và giấy giới thiệu nếu có.",
};
const VISIT_NOTICE_REPEAT = {
  noticeJa: "保険証またはマイナ保険証をお持ちください。",
  noticeEn: "Please bring your health insurance card or My Number insurance card.",
  noticeVi: "Vui lòng mang theo thẻ bảo hiểm y tế hoặc thẻ My Number.",
};

const BOOKING_NO_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O (F7-01)
function bookingNo(i: number) {
  const l = (n: number) => BOOKING_NO_LETTERS[n % BOOKING_NO_LETTERS.length];
  return `${l(i * 7 + 3)}${l(i * 5 + 11)}${l(i * 3 + 17)}${l(i + 5)}${String(1000 + i * 137).slice(-4)}`;
}

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

async function main() {
  console.log(`Seeding (today JST ${today})…`);
  await wipe();
  const now = new Date();
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  await prisma.systemSetting.createMany({
    data: Object.entries({
      group_name_ja: "医療法人社団 誠和会", group_name_en: "Seiwa Medical Corporation", group_name_vi: "Pháp nhân Y tế Seiwa",
      mail_from: "no-reply@example.jp", line_channel_id: "", holiday_source_url: "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv",
      maintenance_from: "", maintenance_to: "", family_member_max: "9",
      // 06 §5 [OD-8]
      retention_questionnaire_days: "90", retention_notes_days: "90", retention_cancel_text_days: "365",
      retention_booking_years: "5", retention_patient_years: "5", retention_withdrawn_days: "30",
      retention_pending_days: "7", retention_session_days: "30", retention_notification_days: "365",
      retention_export_file_days: "30", retention_export_row_years: "5", retention_batch_run_years: "2",
      retention_audit_years: "5", retention_slot_days: "90",
    }).map(([key, value]) => ({ key, value })),
  });

  // masters
  const clinicId: Record<string, string> = {};
  for (const [i, c] of CLINICS.entries()) {
    const row = await prisma.clinic.create({ data: { ...c.data, code: c.code, displayOrder: i + 1 } });
    clinicId[c.code] = row.id;
  }
  const deptId: Record<string, string> = {};
  for (const d of DEPARTMENTS) deptId[d.code] = (await prisma.department.create({ data: d })).id;

  for (const c of CLINICS) {
    await prisma.clinicBusinessHour.createMany({
      data: Object.entries(c.open).flatMap(([wd, bands]) =>
        bands.map((band) => ({
          clinicId: clinicId[c.code], weekday: Number(wd), band,
          openTime: dbTime(c.bands[band].open), closeTime: dbTime(c.bands[band].close), receptionEndTime: dbTime(c.bands[band].reception),
        })),
      ),
    });
    await prisma.clinicDepartment.createMany({
      data: c.departments.map((d, i) => ({ clinicId: clinicId[c.code], departmentId: deptId[d], displayOrder: i + 1 })),
    });
  }

  // accounts
  const accountId: Record<string, string> = {};
  for (const a of SEED_ACCOUNTS) {
    const row = await prisma.account.create({
      data: {
        email: a.email, passwordHash, role: a.role, status: a.status, language: a.language ?? "JA",
        displayName: a.displayName, allClinics: a.allClinics ?? false, mustChangePassword: a.mustChangePassword ?? false,
        notifyChannel: "MAIL", emailVerifiedAt: a.role === "PATIENT" && a.status === "ACTIVE" ? now : null,
      },
    });
    accountId[a.email] = row.id;
    if (a.clinics) {
      await prisma.staffClinic.createMany({ data: a.clinics.map((code) => ({ accountId: row.id, clinicId: clinicId[code] })) });
    }
  }
  const adminAll = accountId["admin.all@example.jp"];
  const adminHonin = accountId["admin.honin@example.jp"];

  // doctors and their shift patterns (valid since 30 days ago, open-ended)
  const doctorId: Record<string, string> = {};
  for (const [i, d] of DOCTORS.entries()) {
    const { primary, depts, shifts, ...data } = d;
    const linked = SEED_ACCOUNTS.find((a) => a.doctorCode === d.code);
    const row = await prisma.doctor.create({
      data: { ...data, primaryClinicId: clinicId[primary], displayOrder: i + 1, accountId: linked ? accountId[linked.email] : null },
    });
    doctorId[d.code] = row.id;
    await prisma.doctorDepartment.createMany({ data: depts.map((dc) => ({ doctorId: row.id, departmentId: deptId[dc] })) });
    for (const s of shifts) {
      const clinic = CLINICS.find((c) => c.code === s.clinic)!;
      await prisma.doctorShiftPattern.createMany({
        data: s.weekdays.flatMap((weekday) =>
          s.bands.map((band) => ({
            doctorId: row.id, clinicId: clinicId[s.clinic], departmentId: deptId[s.dept], weekday, band,
            startTime: dbTime(clinic.bands[band].open), endTime: dbTime(clinic.bands[band].close),
            validFrom: dbDate(addDays(today, -30)),
          })),
        ),
      });
    }
  }

  // visit types: 初診 / 再診 per clinic × department; 内科 also 自費 (健康診断, web) and 予防接種 (staff only)
  const visitTypeId: Record<string, string> = {};
  for (const c of CLINICS) {
    for (const [i, dc] of c.departments.entries()) {
      const p = DEPT_PREFIX[dc];
      const dept = DEPARTMENTS.find((d) => d.code === dc)!;
      const rows: Omit<Prisma.VisitTypeCreateManyInput, "clinicId" | "departmentId">[] = [
        { code: `${p}-SHO`, category: "FIRST", nameJa: "初診", nameEn: "First visit", nameVi: "Khám lần đầu", durationFrames: 2, questionnaireRequired: true, ...VISIT_NOTICE_FIRST, displayOrder: i * 10 + 1 },
        { code: `${p}-SAI`, category: "REPEAT", nameJa: "再診", nameEn: "Follow-up visit", nameVi: "Tái khám", durationFrames: 1, questionnaireRequired: false, ...VISIT_NOTICE_REPEAT, displayOrder: i * 10 + 2 },
      ];
      if (dc === "naika") {
        rows.push(
          { code: "N-KEN", category: "SELF_PAY", nameJa: "自費（健康診断）", nameEn: "Health check (self-pay)", nameVi: "Khám sức khỏe (tự chi trả)", durationFrames: 2, priceYen: 4000, questionnaireRequired: false, displayOrder: i * 10 + 3 },
          { code: "N-VAC", category: "SELF_PAY", nameJa: "予防接種（窓口のみ）", nameEn: "Vaccination (counter only)", nameVi: "Tiêm chủng (chỉ tại quầy)", durationFrames: 1, priceYen: 3500, webBookable: false, questionnaireRequired: false, displayOrder: i * 10 + 4 },
        );
      }
      for (const r of rows) {
        const v = await prisma.visitType.create({ data: { ...r, clinicId: clinicId[c.code], departmentId: deptId[dept.code] } });
        visitTypeId[`${c.code}/${r.code}`] = v.id;
      }
    }
    await prisma.bookingPolicy.create({
      data: {
        clinicId: clinicId[c.code], updatedBy: adminAll,
        phoneMessageJa: "Webでの変更・キャンセルは受付期限を過ぎました。お手数ですがお電話でご連絡ください。",
        phoneMessageEn: "Online changes and cancellations are closed for this booking. Please call us.",
        phoneMessageVi: "Đã hết hạn thay đổi hoặc hủy trực tuyến cho lịch hẹn này. Vui lòng gọi điện cho chúng tôi.",
      },
    });
  }

  // notification templates: the 04 §6 defaults for every clinic (03 §3.26)
  await prisma.notificationTemplate.createMany({
    data: CLINICS.flatMap((c) => defaultTemplateRows().map((t) => ({ ...t, clinicId: clinicId[c.code], updatedBy: adminAll }))),
  });

  // holidays from the X3 fixture, recorded as a B3 run
  const b3 = await prisma.batchRun.create({
    data: { jobCode: "B3", trigger: "MANUAL", startedAt: now, status: "RUNNING", readCount: 0, writtenCount: 0, errorCount: 0 },
  });
  const holidays = parseHolidayCsv(await fetchHolidayFile(), Number(today.slice(0, 4)));
  await prisma.holiday.createMany({
    data: holidays.map((h) => ({ holidayDate: dbDate(h.date), nameJa: h.nameJa, nameEn: h.nameEn, nameVi: h.nameVi, lastRunId: b3.id })),
  });
  await prisma.batchRun.update({
    where: { id: b3.id },
    data: { status: "SUCCESS", endedAt: new Date(), readCount: holidays.length, writtenCount: holidays.length, message: "seed: X3 fixture" },
  });
  const holidaySet = new Set(holidays.map((h) => h.date));

  // clinic calendar exceptions (A01): two closed days and a half day at 本院, a closed day at 駅前院,
  // and 臨時診療 at 本院 on the first holiday in the window
  const special = holidays.find((h) => h.date > today && h.date <= addDays(today, 30))?.date;
  const TRAINING_NOTE = { noteJa: "院内研修のため休診", noteEn: "Closed for staff training", noteVi: "Nghỉ để đào tạo nhân viên" };
  const SPECIAL_NOTE = { noteJa: "臨時診療（午前のみ）", noteEn: "Special opening (morning only)", noteVi: "Mở cửa đặc biệt (chỉ buổi sáng)" };
  const calendar: Prisma.ClinicCalendarDayCreateManyInput[] = [
    { clinicId: clinicId.honin, calDate: dbDate(addDays(today, 8)), kind: "CLOSED", ...TRAINING_NOTE, createdBy: adminHonin },
    { clinicId: clinicId.honin, calDate: dbDate(addDays(today, 9)), kind: "CLOSED", ...TRAINING_NOTE, createdBy: adminHonin },
    { clinicId: clinicId.honin, calDate: dbDate(addDays(today, 20)), kind: "PM_CLOSED", noteJa: "午後休診", noteEn: "Closed in the afternoon", noteVi: "Nghỉ buổi chiều", createdBy: adminHonin },
    { clinicId: clinicId.ekimae, calDate: dbDate(addDays(today, 14)), kind: "CLOSED", noteJa: "設備点検のため休診", noteEn: "Closed for equipment inspection", noteVi: "Nghỉ để kiểm tra thiết bị", createdBy: adminAll },
  ];
  if (special) {
    calendar.push({
      clinicId: clinicId.honin, calDate: dbDate(special), kind: "SPECIAL_OPEN", amOpen: dbTime("09:00"), amClose: dbTime("12:00"),
      ...SPECIAL_NOTE, createdBy: adminHonin,
    });
  }
  // demo days yesterday / today / tomorrow must have frames at 本院 (S01, B1, B4 show real cases): a closed day
  // (Sunday, holiday, 休診 weekday) becomes 臨時診療 AM, staffed by D001 (内科) and D003 (小児科) where no pattern covers it
  const demoExtras: Prisma.DoctorShiftExceptionCreateManyInput[] = [];
  for (const day of [-1, 0, 1].map((n) => addDays(today, n))) {
    const wd = weekdayOf(day);
    if (CLINICS[0].open[wd]?.includes("AM") && !holidaySet.has(day)) continue;
    if (day !== special) {
      calendar.push({
        clinicId: clinicId.honin, calDate: dbDate(day), kind: "SPECIAL_OPEN", amOpen: dbTime("09:00"), amClose: dbTime("12:00"),
        ...SPECIAL_NOTE, createdBy: adminHonin,
      });
    }
    for (const code of ["D001", "D003"]) {
      const d = DOCTORS.find((x) => x.code === code)!;
      const s = d.shifts.find((x) => x.clinic === "honin" && x.weekdays.includes(wd) && x.bands.includes("AM"));
      if (!s) {
        demoExtras.push({
          doctorId: doctorId[code], shiftDate: dbDate(day), kind: "EXTRA", clinicId: clinicId.honin, departmentId: deptId[d.depts[0]],
          band: "AM", startTime: dbTime("09:00"), endTime: dbTime("12:00"), note: "臨時診療", createdBy: adminHonin,
        });
      }
    }
  }
  await prisma.clinicCalendarDay.createMany({ data: calendar });

  // doctor exceptions (A02): 田中 off next Monday-or-later AM, 高橋 extra shift on the 臨時診療 day
  const offDate = [...Array(14).keys()].map((n) => addDays(today, n + 3)).find((d) => weekdayOf(d) === 1 && !holidaySet.has(d))!;
  const exceptions: Prisma.DoctorShiftExceptionCreateManyInput[] = [
    { doctorId: doctorId.D001, shiftDate: dbDate(offDate), kind: "OFF", band: "AM", note: "学会出張", createdBy: adminHonin },
  ];
  if (special) {
    exceptions.push({
      doctorId: doctorId.D002, shiftDate: dbDate(special), kind: "EXTRA", clinicId: clinicId.honin, departmentId: deptId.naika,
      band: "AM", startTime: dbTime("09:00"), endTime: dbTime("12:00"), note: "臨時診療", createdBy: adminHonin,
    });
  }
  await prisma.doctorShiftException.createMany({ data: [...exceptions, ...demoExtras] });

  // frames: B2 itself (06 §B2) over PAST_DAYS before today … today + window + 7 (past frames, so past bookings have real ones)
  const b2 = await runJob("B2", { trigger: "MANUAL", params: { from: addDays(today, -PAST_DAYS), to: addDays(today, 30 + 7) } });
  if (b2.result.status !== "SUCCESS") throw new Error(`B2 failed in the seed: ${b2.result.message}`);

  // consent documents (vendor) and patients
  const docsEffective = new Date("2026-10-01T00:00:00+09:00");
  await prisma.consentDocument.createMany({
    data: (["TERMS", "PRIVACY"] as const).flatMap((kind) =>
      (["JA", "EN", "VI"] as const).map((language) => ({
        kind, version: "1.0", language, effectiveFrom: docsEffective,
        url: `https://example.jp/legal/${kind.toLowerCase()}/1.0/${language.toLowerCase()}`,
      })),
    ),
  });

  const address = { postcode: "1000005", prefecture: "東京都", city: "千代田区", town: "丸の内", addressLine: "2-1-1" };
  const self = (email: string) => ({ accountId: accountId[email], relation: "SELF" as const, createdByKind: "PATIENT" as const });
  const patient = async (data: Omit<Prisma.PatientUncheckedCreateInput, "postcode" | "prefecture" | "city" | "addressLine">) =>
    (await prisma.patient.create({ data: { ...address, ...data } })).id;

  const taro = await patient({ ...self("yamada.taro@example.jp"), nameType: "JP", familyName: "山田", givenName: "太郎", familyNameKana: "ヤマダ", givenNameKana: "タロウ", birthDate: dbDate("1980-04-01"), sex: "MALE", phone: "09012345678", building: "丸の内マンション301" });
  const hanako = await patient({ accountId: accountId["yamada.taro@example.jp"], relation: "SPOUSE", createdByKind: "PATIENT", nameType: "JP", familyName: "山田", givenName: "花子", familyNameKana: "ヤマダ", givenNameKana: "ハナコ", birthDate: dbDate("1982-06-15"), sex: "FEMALE" });
  const keiko = await patient({ accountId: accountId["yamada.taro@example.jp"], relation: "CHILD", createdByKind: "PATIENT", nameType: "JP", familyName: "山田", givenName: "恵子", familyNameKana: "ヤマダ", givenNameKana: "ケイコ", birthDate: dbDate("2015-09-10"), sex: "FEMALE" });
  const suzuki = await patient({ ...self("suzuki.ichiro@example.jp"), nameType: "JP", familyName: "鈴木", givenName: "一郎", familyNameKana: "スズキ", givenNameKana: "イチロウ", birthDate: dbDate("1975-01-20"), sex: "MALE", phone: "0311112222" });
  const nguyen = await patient({ ...self("nguyen.van.an@example.com"), nameType: "ROMAJI", familyName: "Nguyen", givenName: "Van An", familyNameKana: "グエン", givenNameKana: "ヴァン アン", birthDate: dbDate("1995-03-03"), sex: "MALE", phone: "08022223333" });
  const emily = await patient({ ...self("emily.smith@example.com"), nameType: "ROMAJI", familyName: "Smith", givenName: "Emily", familyNameKana: "スミス", givenNameKana: "エミリー", birthDate: dbDate("1990-12-24"), sex: "FEMALE", phone: "08033334444" });
  await patient({ ...self("sasaki.pending@example.jp"), nameType: "JP", familyName: "佐々木", givenName: "美咲", familyNameKana: "ササキ", givenNameKana: "ミサキ", birthDate: dbDate("1998-07-07"), sex: "FEMALE", phone: "09044445555" });
  // staff-registered patient without a web account (F1-06), SMS consent given at S02
  const kimura = await patient({ createdByKind: "STAFF", nameType: "JP", familyName: "木村", givenName: "光", familyNameKana: "キムラ", givenNameKana: "ヒカル", birthDate: dbDate("1968-11-03"), sex: "MALE", phone: "08011112222", smsOptIn: true });

  // demo patient on LINE (B1 reminder channel); not a login account of SEED_ACCOUNTS
  const katoAccount = await prisma.account.create({
    data: {
      email: "kato.line@example.jp", passwordHash, role: "PATIENT", status: "ACTIVE", language: "JA", notifyChannel: "LINE",
      lineUserId: "U0000000000000000000000000000demo", lineFriend: "FOLLOWING", emailVerifiedAt: now,
    },
  });
  accountId["kato.line@example.jp"] = katoAccount.id;
  const kato = await patient({ ...self("kato.line@example.jp"), nameType: "JP", familyName: "加藤", givenName: "陽子", familyNameKana: "カトウ", givenNameKana: "ヨウコ", birthDate: dbDate("1987-05-05"), sex: "FEMALE", phone: "09055556666" });

  await prisma.consent.createMany({
    data: [...SEED_ACCOUNTS.filter((a) => a.role === "PATIENT").map((a) => a.email), "kato.line@example.jp"].flatMap((email) =>
      (["TERMS", "PRIVACY"] as const).map((kind) => ({ accountId: accountId[email], kind, version: "1.0", agreedAt: now })),
    ),
  });
  await prisma.patientCard.createMany({
    data: [
      { patientId: taro, clinicId: clinicId.honin, cardNo: "H-10001", enteredByKind: "STAFF", confirmedAt: now },
      { patientId: nguyen, clinicId: clinicId.ekimae, cardNo: "E-20001", enteredByKind: "PATIENT" },
    ],
  });

  // bookings (frames taken in the same step, as the booking transaction does)
  const slotRows = await prisma.slot.findMany({ orderBy: [{ slotDate: "asc" }, { startTime: "asc" }] });
  const free = (doctor: string, clinic: string, fromDay: number, frames: number, exact = false) => {
    const from = addDays(today, fromDay);
    const own = slotRows.filter((s) => s.doctorId === doctorId[doctor] && s.clinicId === clinicId[clinic] && s.reservedCount === 0
      && (exact ? toIsoDate(s.slotDate) === from : toIsoDate(s.slotDate) >= from));
    for (let i = 0; i + frames <= own.length; i++) {
      const run = own.slice(i, i + frames);
      const contiguous = run.every((s, k) => k === 0 || (s.slotDate.getTime() === run[0].slotDate.getTime() && s.startTime.getTime() === run[k - 1].endTime.getTime()));
      if (contiguous) {
        run.forEach((s) => (s.reservedCount = 1));
        return run;
      }
    }
    throw new Error(`no ${frames} free frames for ${doctor} at ${clinic}`);
  };

  type Plan = {
    patient: string; doctor: string; clinic: string; dept: string; visit: string; fromDay: number; frames: number;
    channel: "WEB" | "PHONE" | "COUNTER"; bookedBy: string | null; requested: boolean; status: "RESERVED" | "CHECKED_IN" | "CANCELED"; price?: number;
    exact?: boolean; createdDaysAgo?: number; adjust?: boolean;
  };
  const shonikaDoctor = (n: number) => (DOCTORS.find((d) => d.code === "D004")!.shifts.some((s) => s.clinic === "honin" && s.weekdays.includes(weekdayOf(addDays(today, n)))) ? "D004" : "D003");
  const taroAcc = accountId["yamada.taro@example.jp"];
  const receptionHonin = accountId["reception.honin@example.jp"];
  // demo bookings yesterday / today / tomorrow at 本院 (S01 ledger, B4 no-show candidate, B1 targets on MAIL / LINE / SMS, 要調整, family)
  const demo = (n: number, patient: string, doctor: string, visit: string, by: string | null, extra: Partial<Plan> = {}): Plan => ({
    patient, doctor, clinic: "honin", dept: doctor === "D001" ? "naika" : "shonika", visit, fromDay: n, frames: visit.endsWith("SHO") || visit === "N-KEN" ? 2 : 1,
    channel: by === receptionHonin ? "PHONE" : "WEB", bookedBy: by, requested: true, status: "RESERVED", exact: true, createdDaysAgo: 3, ...extra,
  });
  const plans: Plan[] = [
    { patient: taro, doctor: "D001", clinic: "honin", dept: "naika", visit: "N-SAI", fromDay: 3, frames: 1, channel: "WEB", bookedBy: accountId["yamada.taro@example.jp"], requested: true, status: "RESERVED" },
    { patient: hanako, doctor: "D002", clinic: "honin", dept: "naika", visit: "N-SHO", fromDay: 5, frames: 2, channel: "PHONE", bookedBy: accountId["reception.honin@example.jp"], requested: false, status: "RESERVED" },
    { patient: taro, doctor: "D001", clinic: "honin", dept: "naika", visit: "N-SAI", fromDay: -PAST_DAYS, frames: 1, channel: "WEB", bookedBy: accountId["yamada.taro@example.jp"], requested: true, status: "CHECKED_IN" },
    { patient: nguyen, doctor: "D005", clinic: "ekimae", dept: "hifuka", visit: "H-SAI", fromDay: 4, frames: 1, channel: "WEB", bookedBy: accountId["nguyen.van.an@example.com"], requested: true, status: "RESERVED" },
    { patient: taro, doctor: "D001", clinic: "honin", dept: "naika", visit: "N-KEN", fromDay: 7, frames: 2, channel: "WEB", bookedBy: accountId["yamada.taro@example.jp"], requested: false, status: "RESERVED", price: 4000 },
    { patient: kimura, doctor: "D007", clinic: "nishiguchi", dept: "naika", visit: "N-SAI", fromDay: 2, frames: 1, channel: "PHONE", bookedBy: accountId["reception.honin@example.jp"], requested: true, status: "CANCELED" },
    // yesterday: 来院済 (family too) and one left RESERVED = B4 no-show candidate
    demo(-1, taro, "D001", "N-SAI", taroAcc, { status: "CHECKED_IN" }),
    demo(-1, keiko, shonikaDoctor(-1), "S-SAI", taroAcc, { status: "CHECKED_IN" }),
    demo(-1, suzuki, "D001", "N-SAI", accountId["suzuki.ichiro@example.jp"]),
    // today: a full ledger across doctors and statuses
    demo(0, nguyen, "D001", "N-SAI", accountId["nguyen.van.an@example.com"], { status: "CHECKED_IN" }),
    demo(0, taro, "D001", "N-SAI", taroAcc),
    demo(0, emily, "D001", "N-KEN", accountId["emily.smith@example.com"], { requested: false, price: 4000 }),
    demo(0, suzuki, "D001", "N-SAI", receptionHonin, { adjust: true }),
    demo(0, kimura, "D001", "N-SAI", receptionHonin, { status: "CANCELED" }),
    demo(0, keiko, shonikaDoctor(0), "S-SAI", taroAcc),
    // tomorrow: reminder targets on MAIL (hanako via taro), LINE (kato), SMS (kimura, no account), one booked < 24 h ago, 要調整
    demo(1, hanako, "D001", "N-SAI", taroAcc),
    demo(1, kato, "D001", "N-SAI", katoAccount.id),
    demo(1, kimura, "D001", "N-SAI", receptionHonin),
    demo(1, emily, "D001", "N-SAI", accountId["emily.smith@example.com"], { createdDaysAgo: 0 }),
    demo(1, nguyen, "D001", "N-SAI", accountId["nguyen.van.an@example.com"], { adjust: true }),
    demo(1, keiko, shonikaDoctor(1), "S-SHO", taroAcc),
  ];
  for (const [i, p] of plans.entries()) {
    const frames = free(p.doctor, p.clinic, p.fromDay, p.frames, p.exact);
    const createdAt = new Date(now.getTime() - (p.createdDaysAgo ?? 0) * 86_400_000);
    const staffBooked = p.channel !== "WEB";
    const canceled = p.status === "CANCELED";
    await prisma.booking.create({
      data: {
        bookingNo: bookingNo(i + 1), clinicId: clinicId[p.clinic], departmentId: deptId[p.dept], visitTypeId: visitTypeId[`${p.clinic}/${p.visit}`],
        doctorId: doctorId[p.doctor], doctorRequested: p.requested, patientId: p.patient, bookedByAccountId: p.bookedBy, channel: p.channel,
        slotDate: frames[0].slotDate, startTime: frames[0].startTime, endTime: frames[frames.length - 1].endTime, status: p.status, priceYen: p.price ?? null,
        checkedInAt: p.status === "CHECKED_IN" ? now : null, createdAt, adjustRequiredAt: p.adjust ? now : null,
        ...(canceled ? { canceledAt: now, canceledByKind: "STAFF" as const, canceledByAccountId: p.bookedBy, cancelReasonCode: "SCHEDULE" as const } : {}),
        events: {
          create: [
            { event: "CREATED", actorKind: staffBooked ? "STAFF" : "PATIENT", actorAccountId: p.bookedBy, channel: staffBooked ? p.channel : null, at: createdAt },
            ...(p.status === "CHECKED_IN" ? [{ event: "CHECKED_IN", actorKind: "STAFF" as const, actorAccountId: accountId["reception.honin@example.jp"], channel: "COUNTER" as const, at: now }] : []),
            ...(canceled ? [{ event: "CANCELED", actorKind: "STAFF" as const, actorAccountId: p.bookedBy, channel: p.channel, at: now }] : []),
          ],
        },
        // a cancelled booking holds no frames (03 §3.23)
        ...(canceled ? {} : { bookingSlots: { create: frames.map((s) => ({ slotId: s.id })) } }),
      },
    });
    if (!canceled) await prisma.slot.updateMany({ where: { id: { in: frames.map((s) => s.id) } }, data: { reservedCount: { increment: 1 } } });
  }

  // B5 demo cases (W5 w1): one row past its 06 §5 period per class, so `npm run batch -- B5` acts on the seed.
  // Patients 保存 (ホゾン) and accounts hozon.* only; no other seed row is touched.
  {
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const sixYears = daysAgo(6 * 366);
    const hozon = (data: Partial<Prisma.PatientUncheckedCreateInput>) => patient({
      createdByKind: "STAFF", nameType: "JP", familyName: "保存", givenName: "一郎", familyNameKana: "ホゾン", givenNameKana: "イチロウ",
      birthDate: dbDate("1970-02-14"), sex: "MALE", phone: "09099990001", ...data,
    });
    let n = 100;
    const old = (patientId: string, daysBack: number, extra: Partial<Prisma.BookingUncheckedCreateInput> = {}) => prisma.booking.create({
      data: {
        bookingNo: bookingNo(++n), clinicId: clinicId.honin, departmentId: deptId.naika, visitTypeId: visitTypeId["honin/N-SAI"], doctorId: doctorId.D001,
        doctorRequested: true, patientId, channel: "PHONE", slotDate: dbDate(addDays(today, -daysBack)), startTime: dbTime("09:00"), endTime: dbTime("09:15"),
        status: "CHECKED_IN", checkedInAt: daysAgo(daysBack), createdAt: daysAgo(daysBack + 3), bookedByAccountId: receptionHonin, ...extra,
        events: { create: [{ event: "CREATED", actorKind: "STAFF", actorAccountId: receptionHonin, channel: "PHONE", at: daysAgo(daysBack + 3) }] },
      },
    });
    const questionnaire = (bookingId: string, daysBack: number) => prisma.questionnaire.create({
      data: { bookingId, formVersion: "1.0", language: "JA", answers: encryptJson({ symptoms: "咳" }), submittedAt: daysAgo(daysBack + 3), purgeAfter: dbDate(addDays(today, -daysBack + 90)) },
    });
    // bookings 5 years past slot_date (events, 問診, notes with it) → then a patient without account and booking → anonymised
    const ichiro = await hozon({ createdAt: sixYears });
    const b5y = await old(ichiro, 5 * 366 + 10, { notes: encryptText("5年前のメモ"), visitTypeId: visitTypeId["honin/N-SHO"], endTime: dbTime("09:30") });
    await questionnaire(b5y.id, 5 * 366 + 10);
    // 問診 past the patient's last visit + 90 days, booking notes 90+ days after the visit, cancel text 1 year after cancellation
    const jiro = await hozon({ givenName: "二郎", givenNameKana: "ジロウ", phone: "09099990002" });
    const b100 = await old(jiro, 100, { notes: encryptText("100日前のメモ"), visitTypeId: visitTypeId["honin/N-SHO"], endTime: dbTime("09:30") });
    await questionnaire(b100.id, 100);
    await old(jiro, 400, {
      status: "CANCELED", checkedInAt: null, canceledAt: daysAgo(400), canceledByKind: "STAFF", canceledByAccountId: receptionHonin,
      cancelReasonCode: "OTHER", cancelReasonText: "仕事の都合",
    });
    await prisma.notification.create({
      data: { event: "NT01_BOOKED", channel: "SMS", language: "JA", patientId: jiro, bookingId: b100.id, toAddress: "09099990002", status: "SENT", queuedAt: daysAgo(400), sentAt: daysAgo(400) },
    });
    // withdrawn 31 days ago (Q-022 setting 30): account deleted, SELF + family anonymised, the family visit kept
    const withdrawn = await prisma.account.create({
      data: { email: "hozon.withdrawn@example.jp", passwordHash, role: "PATIENT", status: "WITHDRAWN", notifyChannel: "MAIL", emailVerifiedAt: daysAgo(400), withdrawnAt: daysAgo(31), createdAt: daysAgo(400) },
    });
    await hozon({ accountId: withdrawn.id, relation: "SELF", createdByKind: "PATIENT", givenName: "三郎", givenNameKana: "サブロウ", phone: "09099990003" });
    const child = await hozon({ accountId: withdrawn.id, relation: "CHILD", createdByKind: "PATIENT", givenName: "四子", givenNameKana: "ヨツコ", phone: null, sex: "FEMALE", birthDate: dbDate("2016-08-01") });
    await old(child, 40, { bookedByAccountId: withdrawn.id, channel: "WEB", notes: encryptText("家族のメモ"), events: { create: [{ event: "CREATED", actorKind: "PATIENT", actorAccountId: withdrawn.id, at: daysAgo(43) }] } });
    // PENDING 8 days, never verified: account, SELF patient, consents (and its token) together
    const pending = await prisma.account.create({
      data: { email: "hozon.pending@example.jp", passwordHash, role: "PATIENT", status: "PENDING", notifyChannel: "MAIL", createdAt: daysAgo(8) },
    });
    await hozon({ accountId: pending.id, relation: "SELF", createdByKind: "PATIENT", givenName: "五郎", givenNameKana: "ゴロウ", phone: "09099990005", createdAt: daysAgo(8) });
    await prisma.consent.createMany({ data: (["TERMS", "PRIVACY"] as const).map((kind) => ({ accountId: pending.id, kind, version: "1.0", agreedAt: daysAgo(8) })) });
    await prisma.authToken.create({ data: { tokenHash: "b5".padEnd(64, "0"), accountId: pending.id, purpose: "EMAIL_VERIFY", expiresAt: daysAgo(7) } });
    // a session and a reset token 31 days past expiry (kato, a demo account)
    await prisma.session.create({ data: { tokenHash: "b5".padEnd(64, "1"), accountId: katoAccount.id, expiresAt: daysAgo(31), lastSeenAt: daysAgo(32), createdAt: daysAgo(32) } });
    await prisma.authToken.create({ data: { tokenHash: "b5".padEnd(64, "2"), accountId: katoAccount.id, purpose: "PASSWORD_RESET", expiresAt: daysAgo(31), createdAt: daysAgo(31) } });
    // export files: a CSV of 31 days ago (file goes, row stays) and a row of 6 years ago (row goes)
    const csv = await storeExportFile("honin_bookings_demo.csv", Buffer.from("予約番号\r\n"));
    const exportRow = (createdAt: Date, storageKey: string, sha256: string) => prisma.exportFile.create({
      data: {
        clinicId: clinicId.honin, kind: "BOOKINGS", trigger: "BATCH", status: "DONE", periodFrom: dbDate(toIsoDate(createdAt)), periodTo: dbDate(toIsoDate(createdAt)),
        fileName: "honin_bookings_demo.csv", storageKey, sha256, rowCount: 0, warningCount: 0, expiresAt: new Date(createdAt.getTime() + 30 * 86_400_000), createdAt,
      },
    });
    await exportRow(daysAgo(31), csv.storageKey, csv.sha256);
    await exportRow(sixYears, "0_honin_bookings_demo_gone.csv", "0".repeat(64));
    // a batch run of 3 years ago, an audit row of 6 years ago, a free frame of 91 days ago
    await prisma.batchRun.create({ data: { jobCode: "B4", trigger: "SCHEDULE", startedAt: daysAgo(3 * 366), endedAt: daysAgo(3 * 366), status: "SUCCESS", readCount: 0, writtenCount: 0, errorCount: 0, message: "B5 demo" } });
    await prisma.auditLog.create({ data: { at: sixYears, accountId: null, action: "LOGIN_OK", detail: { demo: "B5" } } });
    await prisma.slot.create({
      data: {
        clinicId: clinicId.honin, departmentId: deptId.naika, doctorId: doctorId.D001, slotDate: dbDate(addDays(today, -91)), startTime: dbTime("09:00"),
        endTime: dbTime("09:15"), capacity: 1, status: "OPEN", generatedRunId: b2.run!.id,
      },
    });
  }

  console.log(`clinics ${CLINICS.length} · departments ${DEPARTMENTS.length} · doctors ${DOCTORS.length} · accounts ${SEED_ACCOUNTS.length}`);
  console.log(`holidays ${holidays.length} · slots ${await prisma.slot.count()} · bookings ${plans.length}`);
  console.log("Seeding completed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
