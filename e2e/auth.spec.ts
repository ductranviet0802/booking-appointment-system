import { test, expect } from "@playwright/test";
import { assertNoPageErrors, registerUnique, login } from "./helpers";

test.describe("authentication", () => {
  test("register validates password, registers, rejects duplicate, and logs out", async ({ page }, testInfo) => {
    const errors = await assertNoPageErrors(page, testInfo);
    await page.goto("/auth/register");
    await page.getByTestId("register-input-name").fill("E2E Patient");
    await page.getByTestId("register-input-email").fill(`validation-${Date.now()}@example.com`);
    await page.getByTestId("register-input-password").fill("weak");
    await page.getByTestId("register-submit-button").click();
    await expect(page.getByTestId("register-error")).toContainText("ít nhất 8 ký tự");

    const account = await registerUnique(page, "auth");
    await page.getByTestId("navbar-logout-button").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("navbar-login-link")).toBeVisible();

    await page.goto("/auth/register");
    await page.getByTestId("register-input-name").fill("Duplicate");
    await page.getByTestId("register-input-email").fill(account.email);
    await page.getByTestId("register-input-password").fill(account.password);
    await page.getByTestId("register-submit-button").click();
    await expect(page.getByTestId("register-error")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("invalid login is rejected and seeded admin can log in", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByTestId("login-email-input").fill("admin@example.com");
    await page.getByTestId("login-password-input").fill("wrong-password");
    await page.getByTestId("login-submit-button").click();
    await expect(page.getByTestId("login-error")).toBeVisible();
    await login(page, "admin@example.com", "ChangeMe123!");
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  });

  test("login form supports keyboard traversal and waits for the real login response", async ({ page }) => {
    await page.goto("/auth/login");
    const email = page.getByTestId("login-email-input");
    const password = page.getByTestId("login-password-input");
    const submit = page.getByTestId("login-submit-button");
    await email.focus();
    await expect(email).toBeFocused();
    await email.press("Tab");
    await expect(password).toBeFocused();
    await email.fill("admin@example.com");
    await password.fill("ChangeMe123!");
    let releaseLogin = () => {};
    const loginGate = new Promise<void>((resolve) => { releaseLogin = resolve; });
    await page.route("**/api/auth/login", async (route) => {
      await loginGate;
      await route.continue();
    });
    try {
      await password.press("Enter");
      await expect(submit).toBeDisabled();
    } finally {
      releaseLogin();
    }
    await expect(page).toHaveURL(/\/bookings\/me$/);
  });
});
