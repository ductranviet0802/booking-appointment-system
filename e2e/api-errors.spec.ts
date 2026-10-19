import { test, expect } from "@playwright/test";
import { dateInHoChiMinh } from "./helpers";

const doctor = {
  id: "mock-doctor",
  name: "Mock Doctor",
  fee: 200000,
  specialty: { id: "mock-specialty", name: "Nội khoa" },
  hospital: { name: "Mock Hospital" },
};

async function mockBookingPage(page: import("@playwright/test").Page, slots: unknown[], delay = 0) {
  await page.route("**/api/doctors?limit=50", async (route) => {
    await route.fulfill({ json: { doctors: [doctor], total: 1, page: 1, totalPages: 1 } });
  });
  await page.route("**/api/doctors/mock-doctor/slots**", async (route) => {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ json: { slots } });
  });
  await page.goto("/bookings/new?doctor_id=mock-doctor");
  await expect(page.getByTestId("booking-new-page")).toBeVisible();
}

test.describe("booking API failure states", () => {
  test("loading and empty slot states are rendered", async ({ page }) => {
    const date = dateInHoChiMinh(2);
    const loadingPromise = mockBookingPage(page, [], 300);
    await loadingPromise;
    await page.getByTestId(`booking-calendar-date-${date}`).click();
    await expect(page.getByTestId("booking-new-slot-loading")).toBeVisible();
    await expect(page.getByTestId("booking-new-slot-empty")).toBeVisible();
  });

  test("booked slots remain disabled", async ({ page }) => {
    const date = dateInHoChiMinh(2);
    const slot = { id: "booked-slot", date, start_time: "09:00", end_time: "09:30", is_booked: true };
    await mockBookingPage(page, [slot]);
    await page.getByTestId(`booking-calendar-date-${date}`).click();
    await expect(page.getByTestId("booking-slot-item-booked-slot")).toBeDisabled();
  });

  for (const code of ["SLOT_ALREADY_BOOKED", "UNAUTHORIZED", "DAILY_LIMIT_EXCEEDED"]) {
    test(`maps ${code} booking backend error`, async ({ page }) => {
      const date = dateInHoChiMinh(2);
      const slot = { id: `slot-${code}`, date, start_time: "09:00", end_time: "09:30", is_booked: false };
      await mockBookingPage(page, [slot]);
      await page.route("**/api/bookings", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        await route.fulfill({
          status: code === "UNAUTHORIZED" ? 401 : 409,
          contentType: "application/json",
          body: JSON.stringify({ code, message: code }),
        });
      });
      await page.getByTestId(`booking-calendar-date-${date}`).click();
      await page.getByTestId(`booking-slot-item-${slot.id}`).click();
      await page.getByTestId("booking-new-submit-button").click();
      await expect(page.getByTestId("booking-new-error")).toBeVisible();
      const expected = code === "SLOT_ALREADY_BOOKED"
        ? "Khung giờ này vừa được người khác đặt"
        : code === "UNAUTHORIZED"
          ? "Bạn cần đăng nhập"
          : "giới hạn 3 lịch hẹn";
      await expect(page.getByTestId("booking-new-error")).toContainText(expected);
    });
  }
});
