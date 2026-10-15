import { test, expect } from "@playwright/test";
import { assertNoPageErrors, attachPageErrors, chooseSelect, getDoctors } from "./helpers";

test.describe("public discovery", () => {
  test("home exposes specialty and doctor discovery links", async ({ page }, testInfo) => {
    const errors = await assertNoPageErrors(page, testInfo);
    await page.goto("/");
    await expect(page.getByTestId("home-page")).toBeVisible();
    await expect(page.getByTestId("home-hero-action-find-doctors")).toHaveAttribute("href", "/doctors");
    await expect(page.getByTestId("home-specialties-view-all")).toHaveAttribute("href", "/doctors");
    const specialty = page.locator('[data-testid^="home-specialty-item-"]').first();
    await expect(specialty).toBeVisible();
    await expect(specialty).toHaveAttribute("href", /\/doctors\?specialty_id=.+/);
    await specialty.click();
    await expect(page).toHaveURL(/\/doctors\?specialty_id=.+/);
    expect(errors).toEqual([]);
    await attachPageErrors(testInfo, errors);
  });

  test("doctor filters, sorting, reset, and URL pagination work", async ({ page }) => {
    const doctors = await getDoctors(page, "limit=2");
    expect(doctors.doctors.length).toBeGreaterThan(0);
    await page.goto("/doctors?limit=2");
    await expect(page.getByTestId("doctors-page-summary")).toContainText("trang 1/");
    for (const doctor of doctors.doctors) {
      await expect(page.getByTestId(`doctors-page-item-${doctor.id}`)).toContainText(doctor.name);
    }
    const specialtiesResponse = await page.request.get("/api/specialties");
    expect(specialtiesResponse.ok()).toBeTruthy();
    const specialty = ((await specialtiesResponse.json()) as { specialties: Array<{ id: string; name: string }> }).specialties[0]!;
    expect(specialty.id).toBeTruthy();
    await chooseSelect(page, "doctors-filter-specialty-select", specialty.id, specialty.name);
    await expect(page).toHaveURL(/specialty_id=/);
    await page.getByTestId("doctors-filter-city-input").fill("Hà Nội");
    await expect(page).toHaveURL(/city=/);
    await page.getByTestId("doctors-filter-min-fee-input").fill("100000");
    await expect(page).toHaveURL(/min_fee=100000/);
    await page.getByTestId("doctors-filter-max-fee-input").fill("1000000");
    await expect(page).toHaveURL(/max_fee=1000000/);
    await chooseSelect(page, "doctors-filter-sort-select", "fee", "Phí thấp đến cao");
    await expect(page).toHaveURL(/sort=fee/);
    const filteredQuery = new URL(page.url()).searchParams;
    const filtered = await getDoctors(page, filteredQuery.toString());
    if (filtered.doctors.length === 0) {
      await expect(page.getByTestId("doctors-page-empty-state")).toBeVisible();
    } else {
      await expect(page.getByTestId("doctors-page-summary")).toContainText("trang 1/");
      for (const [index, doctor] of filtered.doctors.entries()) {
        const card = page.getByTestId(`doctors-page-item-${doctor.id}`);
        await expect(card).toContainText(doctor.name);
        await expect(card).toContainText(`${doctor.fee.toLocaleString("vi-VN")}đ`);
        if (index > 0) {
          expect(doctor.fee).toBeGreaterThanOrEqual(filtered.doctors[index - 1]!.fee);
        }
      }
    }
    await page.getByTestId("doctors-filter-reset-button").click();
    await expect(page).toHaveURL(/\/doctors\?limit=2&page=1$/);
    await page.goto("/doctors?limit=2&page=2");
    await expect(page).toHaveURL(/page=2/);
    const pageTwo = await getDoctors(page, "limit=2&page=2");
    for (const doctor of pageTwo.doctors) {
      await expect(page.getByTestId(`doctors-page-item-${doctor.id}`)).toContainText(doctor.name);
    }
  });

  test("search supports button, Enter, and empty results", async ({ page }) => {
    const { doctors } = await getDoctors(page, "limit=1");
    const knownName = doctors[0]?.name;
    expect(knownName).toBeTruthy();
    await page.goto("/search");
    await expect(page.getByTestId("search-empty-state")).toContainText("Nhập từ khóa");
    await page.getByTestId("search-input").fill(knownName!);
    await page.getByTestId("search-input").press("Enter");
    await expect(page.locator('[data-testid^="search-result-card-"]').first()).toContainText(knownName!);
    await page.getByTestId("search-input").fill("");
    await page.getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("search-empty-state")).toContainText("Không có kết quả");
    await page.getByTestId("search-input").fill("zzzz-e2e-no-match");
    await page.getByTestId("search-submit-button").click();
    await expect(page.getByTestId("search-empty-state")).toContainText("Không có kết quả");
  });

  test("unknown doctor renders the not found page", async ({ page }) => {
    await page.goto("/doctors/00000000-0000-0000-0000-000000000000");
    await expect(page.getByTestId("not-found-page")).toBeVisible();
    await expect(page.getByTestId("not-found-title")).toBeVisible();
  });
});
