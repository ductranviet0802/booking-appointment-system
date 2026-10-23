// Demo seed for ver1 (N-DATA-02: every row satisfies the ver1 rules). Wipes every table first.
// Run: node bin/run-ts.mjs prisma/seed.ts   (npm run seed)
import "dotenv/config";
import bcrypt from "bcrypt";
import type { Band, Prisma } from "@prisma/client";
import { pool, prisma } from "@/lib/prisma";
import { addDays, dbDate, dbTime, todayJst, toHhmm, toIsoDate, weekdayOf } from "@/lib/datetime";
import { fetchHolidayFile, parseHolidayCsv } from "@/lib/adapters/x3-holidays";
import { SEED_ACCOUNTS, SEED_PASSWORD } from "./seed-accounts";

const today = todayJst();
const PAST_DAYS = 14; // frames before today, so past bookings have real frames
const FRAME_MINUTES = 15; // booking_policies default (OD-11)

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
      nameJa: "○○クリニック 本院", nameEn: "○○ Clinic Main", nameVi: "Phòng khám ○○ Cơ sở chính",
      nameKana: "マルマルクリニック ホンイン", postcode: "1000005", prefecture: "東京都", city: "千代田区",
      addressLine: "丸の内1-2-3 ○○ビル2階", addressEn: "2F ○○ Bldg., 1-2-3 Marunouchi, Chiyoda-ku, Tokyo",
      phone: "0312345678",
      accessJa: "JR東京駅 丸の内北口 徒歩3分。駐車場はありません（近隣のコインパーキングをご利用ください）。",
      accessEn: "3 min walk from JR Tokyo Station, Marunouchi North Exit. No parking (please use a nearby coin parking).",
      accessVi: "Đi bộ 3 phút từ cửa Bắc Marunouchi, ga JR Tokyo. Không có bãi đỗ xe.",
      mapUrl: "https://maps.google.com/?q=%E6%9D%B1%E4%BA%AC%E9%83%BD%E5%8D%83%E4%BB%A3%E7%94%B0%E5%8C%BA%E4%B8%B8%E3%81%AE%E5%86%851-2-3",
      noticeJa: "院内研修のため臨時休診日があります。休診日・臨時診療の一覧をご確認ください。",
      noticeEn: "The clinic is closed on some days for staff training. Please check the list of closed days.",
    },
    bands: { AM: { open: "09:00", close: "12:00", reception: "11:30" }, PM: { open: "15:00", close: "18:00", reception: "17:30" } },
    open: { 1: ["AM", "PM"], 2: ["AM", "PM"], 3: ["AM"], 4: ["AM", "PM"], 5: ["AM", "PM"], 6: ["AM"] },
    departments: ["naika", "shonika", "hifuka"],
  },
  {
    code: "ekimae",
    data: {
      nameJa: "○○クリニック 駅前院", nameEn: "○○ Clinic Ekimae", nameVi: "Phòng khám ○○ Cơ sở Ekimae",
      nameKana: "マルマルクリニック エキマエイン", postcode: "1600022", prefecture: "東京都", city: "新宿区",
      addressLine: "新宿3-4-5 駅前ビル5階", addressEn: "5F Ekimae Bldg., 3-4-5 Shinjuku, Shinjuku-ku, Tokyo",
      phone: "0323456789",
      accessJa: "JR新宿駅 東口 徒歩2分。提携駐車場はありません。",
      accessEn: "2 min walk from JR Shinjuku Station, East Exit. No partner parking.",
    },
    bands: { AM: { open: "09:30", close: "12:30", reception: "12:00" }, PM: { open: "14:30", close: "18:30", reception: "18:00" } },
    open: { 1: ["AM", "PM"], 2: ["AM", "PM"], 3: ["AM", "PM"], 4: ["AM"], 5: ["AM", "PM"], 6: ["AM"] },
    departments: ["naika", "hifuka"],
  },
  {
    code: "nishiguchi",
    data: {
      nameJa: "○○クリニック 西口院", nameEn: "○○ Clinic Nishiguchi", nameVi: "Phòng khám ○○ Cơ sở Nishiguchi",
      nameKana: "マルマルクリニック ニシグチイン", postcode: "1710021", prefecture: "東京都", city: "豊島区",
      addressLine: "西池袋1-6-7", addressEn: "1-6-7 Nishi-Ikebukuro, Toshima-ku, Tokyo",
      phone: "0334567890",
      accessJa: "池袋駅 西口 徒歩5分。駐車場2台あり。",
      accessEn: "5 min walk from Ikebukuro Station, West Exit. Parking for 2 cars.",
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
    qualificationsJa: "日本内科学会 総合内科専門医",
    shifts: [{ clinic: "honin", dept: "naika", weekdays: [1, 2, 4, 5], bands: ["AM", "PM"] }, { clinic: "honin", dept: "naika", weekdays: [6], bands: ["AM"] }],
  },
  {
    code: "D002", familyName: "高橋", givenName: "由美", familyNameKana: "タカハシ", givenNameKana: "ユミ", nameRomaji: "Yumi Takahashi",
    title: "DOCTOR", languages: ["ja"], primary: "honin", depts: ["naika"],
    profileJa: "総合病院 内科勤務を経て、2020年より当院勤務。",
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
    shifts: [{ clinic: "honin", dept: "shonika", weekdays: [1, 2, 4, 5], bands: ["AM", "PM"] }],
  },
  {
    code: "D004", familyName: "松本", givenName: "亮", familyNameKana: "マツモト", givenNameKana: "リョウ", nameRomaji: "Ryo Matsumoto",
    title: "DOCTOR", languages: ["ja"], primary: "nishiguchi", depts: ["shonika"],
    profileJa: "小児科医。地域の小児医療に携わる。",
    shifts: [
      { clinic: "honin", dept: "shonika", weekdays: [3, 6], bands: ["AM"] },
      { clinic: "nishiguchi", dept: "shonika", weekdays: [1, 2], bands: ["AM", "PM"] },
    ],
  },
  {
    code: "D005", familyName: "渡辺", givenName: "隆", familyNameKana: "ワタナベ", givenNameKana: "タカシ", nameRomaji: "Takashi Watanabe",
    title: "DOCTOR", languages: ["ja", "en"], primary: "ekimae", depts: ["hifuka"],
    profileJa: "皮膚科専門医。アトピー性皮膚炎の診療に従事。", qualificationsJa: "日本皮膚科学会 皮膚科専門医",
    shifts: [
      { clinic: "ekimae", dept: "hifuka", weekdays: [1, 3], bands: ["AM", "PM"] },
      { clinic: "ekimae", dept: "hifuka", weekdays: [5], bands: ["AM"] },
    ],
  },
  {
    code: "D006", familyName: "伊藤", givenName: "真理", familyNameKana: "イトウ", givenNameKana: "マリ", nameRomaji: "Mari Ito",
    title: "PART_TIME", languages: ["ja", "vi"], primary: "nishiguchi", depts: ["hifuka"],
    profileJa: "非常勤の皮膚科医。ベトナム語で診療できます。", profileVi: "Bác sĩ da liễu bán thời gian. Có thể khám bằng tiếng Việt.",
    shifts: [
      { clinic: "nishiguchi", dept: "hifuka", weekdays: [4], bands: ["AM", "PM"] },
      { clinic: "nishiguchi", dept: "hifuka", weekdays: [5], bands: ["AM"] },
      { clinic: "honin", dept: "hifuka", weekdays: [2], bands: ["PM"] },
    ],
  },
  {
    code: "D007", familyName: "小林", givenName: "直樹", familyNameKana: "コバヤシ", givenNameKana: "ナオキ", nameRomaji: "Naoki Kobayashi",
    title: "DOCTOR", languages: ["ja", "en"], primary: "nishiguchi", depts: ["naika"],
    profileJa: "内科医。生活習慣病の診療に従事。",
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

function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function hhmmOf(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
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
      group_name_ja: "医療法人○○会", group_name_en: "○○ Medical Corporation", group_name_vi: "Pháp nhân Y tế ○○",
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
  const calendar: Prisma.ClinicCalendarDayCreateManyInput[] = [
    { clinicId: clinicId.honin, calDate: dbDate(addDays(today, 8)), kind: "CLOSED", noteJa: "院内研修のため休診", noteEn: "Closed for staff training", createdBy: adminHonin },
    { clinicId: clinicId.honin, calDate: dbDate(addDays(today, 9)), kind: "CLOSED", noteJa: "院内研修のため休診", noteEn: "Closed for staff training", createdBy: adminHonin },
    { clinicId: clinicId.honin, calDate: dbDate(addDays(today, 20)), kind: "PM_CLOSED", noteJa: "午後休診", createdBy: adminHonin },
    { clinicId: clinicId.ekimae, calDate: dbDate(addDays(today, 14)), kind: "CLOSED", noteJa: "設備点検のため休診", createdBy: adminAll },
  ];
  if (special) {
    calendar.push({
      clinicId: clinicId.honin, calDate: dbDate(special), kind: "SPECIAL_OPEN", amOpen: dbTime("09:00"), amClose: dbTime("12:00"),
      noteJa: "臨時診療（午前のみ）", noteEn: "Special opening (morning only)", createdBy: adminHonin,
    });
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
  await prisma.doctorShiftException.createMany({ data: exceptions });

  // frames: a plain stand-in for B2 (wave W2) — patterns ∩ open bands (hours, calendar, holidays), minus OFF, plus EXTRA,
  // from 14 days ago to today + window + 7
  const b2 = await prisma.batchRun.create({
    data: { jobCode: "B2", trigger: "MANUAL", startedAt: new Date(), status: "RUNNING", readCount: 0, writtenCount: 0, errorCount: 0 },
  });
  const slots: Prisma.SlotCreateManyInput[] = [];
  for (let n = -PAST_DAYS; n <= 30 + 7; n++) {
    const date = addDays(today, n);
    const wd = weekdayOf(date);
    for (const c of CLINICS) {
      const cal = calendar.find((x) => x.clinicId === clinicId[c.code] && toIsoDate(x.calDate as Date) === date);
      let openBands: Band[] = holidaySet.has(date) ? [] : (c.open[wd] ?? []);
      if (cal?.kind === "CLOSED") openBands = [];
      if (cal?.kind === "AM_CLOSED") openBands = openBands.filter((b) => b !== "AM");
      if (cal?.kind === "PM_CLOSED") openBands = openBands.filter((b) => b !== "PM");
      if (cal?.kind === "SPECIAL_OPEN") openBands = [...(cal.amOpen ? ["AM" as Band] : []), ...(cal.pmOpen ? ["PM" as Band] : [])];

      const shifts: Array<{ doctor: string; dept: string; band: Band; start: string; end: string }> = [];
      for (const d of DOCTORS) {
        for (const s of d.shifts) {
          if (s.clinic !== c.code || !s.weekdays.includes(wd)) continue;
          for (const band of s.bands) {
            if (!openBands.includes(band)) continue;
            if (exceptions.some((e) => e.kind === "OFF" && e.doctorId === doctorId[d.code] && toIsoDate(e.shiftDate as Date) === date && (!e.band || e.band === band))) continue;
            shifts.push({ doctor: d.code, dept: s.dept, band, start: c.bands[band].open, end: c.bands[band].close });
          }
        }
      }
      for (const e of exceptions) {
        if (e.kind === "EXTRA" && e.clinicId === clinicId[c.code] && toIsoDate(e.shiftDate as Date) === date) {
          const code = Object.keys(doctorId).find((k) => doctorId[k] === e.doctorId)!;
          const dept = Object.keys(deptId).find((k) => deptId[k] === e.departmentId)!;
          shifts.push({ doctor: code, dept, band: e.band!, start: toHhmm(e.startTime as Date), end: toHhmm(e.endTime as Date) });
        }
      }
      for (const s of shifts) {
        for (let t = minutes(s.start); t + FRAME_MINUTES <= minutes(s.end); t += FRAME_MINUTES) {
          slots.push({
            clinicId: clinicId[c.code], departmentId: deptId[s.dept], doctorId: doctorId[s.doctor], slotDate: dbDate(date),
            startTime: dbTime(hhmmOf(t)), endTime: dbTime(hhmmOf(t + FRAME_MINUTES)), capacity: 1, status: "OPEN", generatedRunId: b2.id,
          });
        }
      }
    }
  }
  await prisma.slot.createMany({ data: slots });
  await prisma.batchRun.update({
    where: { id: b2.id },
    data: { status: "SUCCESS", endedAt: new Date(), writtenCount: slots.length, message: "seed: frames for the demo" },
  });

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
  await patient({ accountId: accountId["yamada.taro@example.jp"], relation: "CHILD", createdByKind: "PATIENT", nameType: "JP", familyName: "山田", givenName: "恵子", familyNameKana: "ヤマダ", givenNameKana: "ケイコ", birthDate: dbDate("2015-09-10"), sex: "FEMALE" });
  await patient({ ...self("suzuki.ichiro@example.jp"), nameType: "JP", familyName: "鈴木", givenName: "一郎", familyNameKana: "スズキ", givenNameKana: "イチロウ", birthDate: dbDate("1975-01-20"), sex: "MALE", phone: "0311112222" });
  const nguyen = await patient({ ...self("nguyen.van.an@example.com"), nameType: "ROMAJI", familyName: "Nguyen", givenName: "Van An", familyNameKana: "グエン", givenNameKana: "ヴァン アン", birthDate: dbDate("1995-03-03"), sex: "MALE", phone: "08022223333" });
  await patient({ ...self("emily.smith@example.com"), nameType: "ROMAJI", familyName: "Smith", givenName: "Emily", familyNameKana: "スミス", givenNameKana: "エミリー", birthDate: dbDate("1990-12-24"), sex: "FEMALE", phone: "08033334444" });
  await patient({ ...self("sasaki.pending@example.jp"), nameType: "JP", familyName: "佐々木", givenName: "美咲", familyNameKana: "ササキ", givenNameKana: "ミサキ", birthDate: dbDate("1998-07-07"), sex: "FEMALE", phone: "09044445555" });
  // staff-registered patient without a web account (F1-06), SMS consent given at S02
  const kimura = await patient({ createdByKind: "STAFF", nameType: "JP", familyName: "木村", givenName: "光", familyNameKana: "キムラ", givenNameKana: "ヒカル", birthDate: dbDate("1968-11-03"), sex: "MALE", phone: "08011112222", smsOptIn: true });

  await prisma.consent.createMany({
    data: SEED_ACCOUNTS.filter((a) => a.role === "PATIENT").flatMap((a) =>
      (["TERMS", "PRIVACY"] as const).map((kind) => ({ accountId: accountId[a.email], kind, version: "1.0", agreedAt: now })),
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
  const free = (doctor: string, clinic: string, fromDay: number, frames: number) => {
    const from = addDays(today, fromDay);
    const own = slotRows.filter((s) => s.doctorId === doctorId[doctor] && s.clinicId === clinicId[clinic] && toIsoDate(s.slotDate) >= from && s.reservedCount === 0);
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
  };
  const plans: Plan[] = [
    { patient: taro, doctor: "D001", clinic: "honin", dept: "naika", visit: "N-SAI", fromDay: 3, frames: 1, channel: "WEB", bookedBy: accountId["yamada.taro@example.jp"], requested: true, status: "RESERVED" },
    { patient: hanako, doctor: "D002", clinic: "honin", dept: "naika", visit: "N-SHO", fromDay: 5, frames: 2, channel: "PHONE", bookedBy: accountId["reception.honin@example.jp"], requested: false, status: "RESERVED" },
    { patient: taro, doctor: "D001", clinic: "honin", dept: "naika", visit: "N-SAI", fromDay: -PAST_DAYS, frames: 1, channel: "WEB", bookedBy: accountId["yamada.taro@example.jp"], requested: true, status: "CHECKED_IN" },
    { patient: nguyen, doctor: "D005", clinic: "ekimae", dept: "hifuka", visit: "H-SAI", fromDay: 4, frames: 1, channel: "WEB", bookedBy: accountId["nguyen.van.an@example.com"], requested: true, status: "RESERVED" },
    { patient: taro, doctor: "D001", clinic: "honin", dept: "naika", visit: "N-KEN", fromDay: 7, frames: 2, channel: "WEB", bookedBy: accountId["yamada.taro@example.jp"], requested: false, status: "RESERVED", price: 4000 },
    { patient: kimura, doctor: "D007", clinic: "nishiguchi", dept: "naika", visit: "N-SAI", fromDay: 2, frames: 1, channel: "PHONE", bookedBy: accountId["reception.honin@example.jp"], requested: true, status: "CANCELED" },
  ];
  for (const [i, p] of plans.entries()) {
    const frames = free(p.doctor, p.clinic, p.fromDay, p.frames);
    const staffBooked = p.channel !== "WEB";
    const canceled = p.status === "CANCELED";
    await prisma.booking.create({
      data: {
        bookingNo: bookingNo(i + 1), clinicId: clinicId[p.clinic], departmentId: deptId[p.dept], visitTypeId: visitTypeId[`${p.clinic}/${p.visit}`],
        doctorId: doctorId[p.doctor], doctorRequested: p.requested, patientId: p.patient, bookedByAccountId: p.bookedBy, channel: p.channel,
        slotDate: frames[0].slotDate, startTime: frames[0].startTime, endTime: frames[frames.length - 1].endTime, status: p.status, priceYen: p.price ?? null,
        checkedInAt: p.status === "CHECKED_IN" ? now : null,
        ...(canceled ? { canceledAt: now, canceledByKind: "STAFF" as const, canceledByAccountId: p.bookedBy, cancelReasonCode: "SCHEDULE" as const } : {}),
        events: {
          create: [
            { event: "CREATED", actorKind: staffBooked ? "STAFF" : "PATIENT", actorAccountId: p.bookedBy, channel: staffBooked ? p.channel : null, at: now },
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

  console.log(`clinics ${CLINICS.length} · departments ${DEPARTMENTS.length} · doctors ${DOCTORS.length} · accounts ${SEED_ACCOUNTS.length}`);
  console.log(`holidays ${holidays.length} · slots ${slots.length} · bookings ${plans.length}`);
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
