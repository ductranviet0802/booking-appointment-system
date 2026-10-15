import { test, expect } from "@playwright/test";
import { login } from "./helpers";

type Booking = {
  id: string;
  status: "CONFIRMED" | "CANCELED";
  slot: { date: string; start_time: string };
};

test("my bookings tabs render the records returned by the real API", async ({ page }) => {
  await login(page, "admin@example.com", "ChangeMe123!");
  const response = await page.request.get("/api/bookings/me", { headers: { "Cache-Control": "no-cache" } });
  expect(response.ok()).toBeTruthy();
  const bookings = ((await response.json()) as { bookings: Booking[] }).bookings;
  const currentTimestamp = Date.now();
  const groups = {
    upcoming: bookings.filter((booking) => booking.status === "CONFIRMED" && Date.parse(`${booking.slot.date}T${booking.slot.start_time}:00.000Z`) >= currentTimestamp),
    past: bookings.filter((booking) => booking.status === "CONFIRMED" && Date.parse(`${booking.slot.date}T${booking.slot.start_time}:00.000Z`) < currentTimestamp),
    canceled: bookings.filter((booking) => booking.status === "CANCELED"),
  } as const;

  for (const [tab, expected] of Object.entries(groups)) {
    await page.getByTestId(`my-bookings-tab-${tab}`).click();
    if (expected.length === 0) {
      await expect(page.getByTestId("my-bookings-empty-state")).toBeVisible();
    } else {
      for (const booking of expected) {
        await expect(page.getByTestId(`my-bookings-item-${booking.id}`)).toBeVisible();
        await expect(page.getByTestId(`my-bookings-item-${booking.id}-status`)).toHaveText(booking.status);
      }
    }
  }
});
