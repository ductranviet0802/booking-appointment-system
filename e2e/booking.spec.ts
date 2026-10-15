import { test, expect } from "@playwright/test";
import { assertNoPageErrors, attachPageErrors, dateInHoChiMinh, getAvailableSlot, getDoctors, registerUnique } from "./helpers";

test.describe("real booking lifecycle", () => {
  test("registers, books a future slot, verifies it, cancels, and frees the slot", async ({ page }, testInfo) => {
    const errors = await assertNoPageErrors(page, testInfo);
    const account = await registerUnique(page, "booking");
    const { doctors } = await getDoctors(page, "limit=50");
    const date = dateInHoChiMinh(2);
    let selectedDoctor = null;
    let selectedSlot = null;
    for (const doctor of doctors) {
      const slot = await getAvailableSlot(page, doctor.id, date);
      if (slot) {
        selectedDoctor = doctor;
        selectedSlot = slot;
        break;
      }
    }
    expect(selectedDoctor).toBeTruthy();
    expect(selectedSlot).toBeTruthy();

    await page.goto(`/doctors/${selectedDoctor!.id}`);
    await page.getByTestId("doctor-detail-book-now-link").click();
    await expect(page.getByTestId("booking-new-page")).toBeVisible();
    await page.getByTestId(`booking-calendar-date-${date}`).click();
    await expect(page.getByTestId(`booking-slot-item-${selectedSlot!.id}`)).toBeEnabled();
    await page.getByTestId(`booking-slot-item-${selectedSlot!.id}`).click();
    await page.getByTestId("booking-new-notes-input").fill("E2E regression booking");
    let bookingPayload: { slot_id?: string; notes?: string } | undefined;
    await page.route("**/api/bookings", async (route) => {
      if (route.request().method() === "POST") {
        bookingPayload = route.request().postDataJSON() as { slot_id?: string; notes?: string };
      }
      await route.continue();
    });
    await page.getByTestId("booking-new-submit-button").click();
    await expect(page).toHaveURL(/\/bookings\/.+\/success$/);
    await expect(page.getByTestId("booking-success-page")).toBeVisible();
    expect(bookingPayload).toEqual({ slot_id: selectedSlot!.id, notes: "E2E regression booking" });
    const successId = await page.getByTestId("booking-success-id").textContent();
    const bookingId = successId?.match(/[0-9a-f-]{36}/i)?.[0];
    expect(bookingId).toBeTruthy();

    await page.getByTestId("booking-success-my-bookings-link").click();
    await expect(page.getByTestId(`my-bookings-item-${bookingId}`)).toBeVisible();
    await page.getByTestId(`my-bookings-item-${bookingId}-cancel-link`).click();
    await expect(page.getByTestId("booking-cancel-page")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}/cancel$`));
    await page.getByTestId("booking-cancel-back-button").click();
    await expect(page).toHaveURL(/\/bookings\/me$/);
    await expect(page.getByTestId(`my-bookings-item-${bookingId}-status`)).toHaveText("CONFIRMED");
    await page.getByTestId(`my-bookings-item-${bookingId}-cancel-link`).click();
    await expect(page.getByTestId("booking-cancel-page")).toBeVisible();
    await page.getByTestId("booking-cancel-confirm-button").click();
    await expect(page).toHaveURL(/\/bookings\/me$/);
    await page.getByTestId("my-bookings-tab-canceled").click();
    await expect(page.getByTestId(`my-bookings-item-${bookingId}`)).toBeVisible();
    await expect(page.getByTestId(`my-bookings-item-${bookingId}-status`)).toHaveText("CANCELED");

    const detailResponse = await page.request.get(`/api/bookings/${bookingId}`, { headers: { "Cache-Control": "no-cache" } });
    expect(detailResponse.ok()).toBeTruthy();
    expect((await detailResponse.json()).booking.status).toBe("CANCELED");
    const freedSlot = await getAvailableSlot(page, selectedDoctor!.id, date);
    expect(freedSlot?.id).toBe(selectedSlot!.id);
    expect(account.email).toContain("booking-");
    expect(errors).toEqual([]);
    await attachPageErrors(testInfo, errors);
  });
});
