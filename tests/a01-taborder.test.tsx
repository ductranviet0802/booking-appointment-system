// J-03: A01 Tab order by DOM order (no positive tabindex): on the カレンダー tab the tab list (1) → the grid (7) → 期間で設定 (12)
// → 要調整 (17) → 保存する (18). The drawing (12 in the month bar, 17 in the heading row) is CSS grid areas only.
import { renderToStaticMarkup } from "react-dom/server";
import { loadClinic, loadState } from "@/lib/admin/calendar";
import { dbDate, dbTime, todayJst } from "@/lib/datetime";
import { pool, prisma } from "@/lib/prisma";
import { fixture, type Fixture } from "./b2-helpers";

jest.mock("../app/(staff)/admin/calendar/calendar.module.css", () => ({}));
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast: jest.fn() }), useLang: () => "ja" }));
jest.mock("@/lib/client/api", () => ({ useApiFetch: () => jest.fn(), postJson: jest.fn(), openStaffErrorScreen: jest.fn() }));

import { CalendarClient } from "@/app/(staff)/admin/calendar/CalendarClient";

let f: Fixture;
beforeAll(async () => {
  f = await fixture({ doctors: 1 });
  await prisma.booking.create({
    data: {
      bookingNo: "TABA0001", clinicId: f.clinic.id, departmentId: f.dept.id, visitTypeId: f.visitType.id, doctorId: f.doctors[0].id, doctorRequested: true,
      patientId: f.patient.id, channel: "WEB", slotDate: dbDate("2030-03-04"), startTime: dbTime("09:00"), endTime: dbTime("09:15"), adjustRequiredAt: new Date(),
    },
  });
});
afterAll(async () => {
  await f.cleanup();
  await prisma.$disconnect();
  await pool.end();
});

it("calendar tab: tablist → grid → 期間で設定 → 要調整 → 保存する in the DOM; no positive tabindex", async () => {
  const html = renderToStaticMarkup(<CalendarClient role="ADMIN" initial={await loadState(f.clinic.id, todayJst().slice(0, 7))} clinic={(await loadClinic(f.clinic.id))!} />);
  const at = (s: string) => {
    const i = html.indexOf(s);
    expect(i).toBeGreaterThan(-1);
    return i;
  };
  const order = [at('role="tablist"'), at('aria-label="診療カレンダー" tabindex="0"'), at("期間で設定"), at("要調整 "), at("保存する")];
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(html).not.toMatch(/tabindex="[1-9]/);
});
