import { test, expect } from "@playwright/test";
import { getDoctors, chooseSelect } from "./helpers";

async function assertOpenDropdown(page: import("@playwright/test").Page, triggerId: string) {
  const trigger = page.getByTestId(triggerId);
  await trigger.click();
  const listbox = page.getByRole("listbox").last();
  await expect(listbox).toBeVisible();
  const bounds = await listbox.boundingBox();
  expect(bounds).toBeTruthy();
  expect(bounds!.height).toBeLessThanOrEqual(320.01);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual((await page.evaluate(() => innerWidth)) + 1);
  return { trigger, listbox };
}

test.describe("shared dropdown controls", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("specialty dropdown supports selection, keyboard, escape focus, and outside close", async ({ page }) => {
    await page.goto("/doctors?limit=2");
    const specialties = (await (await page.request.get("/api/specialties")).json()) as { specialties: Array<{ id: string; name: string }> };
    const first = specialties.specialties[0]!;
    const { trigger, listbox } = await assertOpenDropdown(page, "doctors-filter-specialty-select");
    await expect(listbox.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
    await expect(trigger).toBeFocused();
    await chooseSelect(page, "doctors-filter-specialty-select", first.id, first.name);
    await expect(page).toHaveURL(new RegExp(`specialty_id=${first.id}`));
    await expect(trigger).toContainText(first.name);
    await trigger.click();
    const headingBounds = await page.getByTestId("doctors-page-title").boundingBox();
    expect(headingBounds).toBeTruthy();
    await page.mouse.click(headingBounds!.x + 8, headingBounds!.y + 8);
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("sort dropdown selects with ArrowDown and Enter and reset restores placeholder", async ({ page }) => {
    await page.goto("/doctors?limit=2");
    const trigger = page.getByTestId("doctors-filter-sort-select");
    await trigger.focus();
    await trigger.press("Enter");
    const defaultOption = page.getByRole("option").filter({ hasText: "Mặc định" });
    await expect(defaultOption).toBeFocused();
    await defaultOption.press("ArrowDown");
    const ratingOption = page.getByRole("option").filter({ hasText: "Đánh giá cao" });
    await expect(ratingOption).toBeFocused();
    await ratingOption.press("Enter");
    await expect(trigger).toContainText("Đánh giá cao");
    await expect(page).toHaveURL(/sort=rating/);
    await chooseSelect(page, "doctors-filter-sort-select", "fee", "Phí thấp đến cao");
    await expect(trigger).toContainText("Phí thấp đến cao");
    await expect(page).toHaveURL(/sort=fee/);
    await page.getByTestId("doctors-filter-reset-button").click();
    await expect(trigger).toContainText(/mặc định|sắp xếp/i);
  });

  test("doctor dropdown keeps long labels usable and scrollable on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/bookings/new");
    const doctors = await getDoctors(page, "limit=50");
    const { trigger, listbox } = await assertOpenDropdown(page, "booking-new-doctor-select");
    await expect(listbox.getByRole("option")).toHaveCount(doctors.doctors.length + 1);
    const viewport = listbox.locator('[data-radix-select-viewport]');
    const overflow = await viewport.evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(overflow || doctors.doctors.length < 8).toBeTruthy();
    await page.getByTestId(`booking-new-doctor-option-${doctors.doctors[0]!.id}`).click();
    await expect(trigger).toContainText(`${doctors.doctors[0]!.name} - ${doctors.doctors[0]!.specialty.name}`);
    await trigger.press("Tab");
  });

  test("all shared dropdowns stay within the viewport on mobile and desktop", async ({ page }) => {
    const { doctors } = await getDoctors(page, "limit=1");
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/doctors?limit=2");
      await assertOpenDropdown(page, "doctors-filter-specialty-select");
      await page.keyboard.press("Escape");
      await assertOpenDropdown(page, "doctors-filter-sort-select");
      await page.keyboard.press("Escape");
      await page.goto(`/bookings/new?doctor_id=${doctors[0]!.id}`);
      await assertOpenDropdown(page, "booking-new-doctor-select");
      await page.keyboard.press("Escape");
    }
  });
});
