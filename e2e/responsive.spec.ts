import { test, expect } from "@playwright/test";
import { assertNoHorizontalOverflow, assertNoPageErrors, attachPageErrors, getDoctors, registerUnique } from "./helpers";

test.describe("responsive public and authenticated routes", () => {
  test("public routes fit common viewport widths and produce screenshots", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const errors = await assertNoPageErrors(page, testInfo);
    const { doctors } = await getDoctors(page, "limit=1");
    const detailPath = `/doctors/${doctors[0]!.id}`;
    for (const viewport of [390, 768, 1440]) {
      await page.setViewportSize({ width: viewport, height: 900 });
      for (const path of ["/", "/doctors", "/search", "/auth/login", "/auth/register", detailPath, `/bookings/new?doctor_id=${doctors[0]!.id}`, "/bookings/me"]) {
        await page.goto(path);
        await expect(page.getByTestId("navbar-login-button")).toBeEnabled();
        await assertNoHorizontalOverflow(page);
      }
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    await expect(page.getByTestId("navbar-login-button")).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("public-home.png"), fullPage: true });
    await page.goto("/doctors");
    await expect(page.getByTestId("doctors-page-summary")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("public-doctors.png"), fullPage: true });
    expect(errors).toEqual([]);
    await attachPageErrors(testInfo, errors);
  });

  test("authenticated navbar fits without horizontal overflow", async ({ page }, testInfo) => {
    await registerUnique(page, "responsive");
    for (const viewport of [390, 768, 1440]) {
      await page.setViewportSize({ width: viewport, height: 900 });
      await page.goto("/bookings/me");
      await expect(page.getByTestId("navbar-user-name")).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
    await page.screenshot({ path: testInfo.outputPath("authenticated-bookings.png"), fullPage: true });
  });
});
