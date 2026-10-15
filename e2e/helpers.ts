import { expect, type Page, type TestInfo } from "@playwright/test";

export type Doctor = {
  id: string;
  name: string;
  fee: number;
  specialty: { id: string; name: string };
  hospital: { name: string };
};

export type Slot = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  is_booked: boolean;
};

export function dateInHoChiMinh(daysFromToday: number) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + daysFromToday);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function registerUnique(page: Page, prefix = "e2e") {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/auth/register");
  await page.getByTestId("register-input-name").fill("E2E Patient");
  await page.getByTestId("register-input-email").fill(email);
  await page.getByTestId("register-input-password").fill("ChangeMe123!");
  await page.getByTestId("register-input-phone").fill("0900000000");
  await page.getByTestId("register-submit-button").click();
  await expect(page).toHaveURL(/\/bookings\/me$/);
  return { email, password: "ChangeMe123!" };
}

export async function login(page: Page, email: string, password = "ChangeMe123!") {
  await page.goto("/auth/login");
  await page.getByTestId("login-email-input").fill(email);
  await page.getByTestId("login-password-input").fill(password);
  await page.getByTestId("login-submit-button").click();
  await expect(page).toHaveURL(/\/bookings\/me$/);
}

export async function getDoctors(page: Page, query = "limit=50") {
  const response = await page.request.get(`/api/doctors?${query}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as { doctors: Doctor[]; total: number; totalPages: number };
}

export async function getAvailableSlot(page: Page, doctorId: string, date: string) {
  const response = await page.request.get(`/api/doctors/${doctorId}/slots?date=${date}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  expect(response.ok()).toBeTruthy();
  const data = (await response.json()) as { slots: Slot[] };
  return data.slots.find((slot) => !slot.is_booked) ?? null;
}

export async function chooseSelect(page: Page, testId: string, value: string, label?: string) {
  const control = page.getByTestId(testId);
  if (await control.evaluate((element) => element.tagName === "SELECT")) {
    await control.selectOption(value);
    return;
  }

  if (!label) throw new Error(`A visible option label is required for ${testId}`);
  await control.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await listbox.getByRole("option").filter({ hasText: label }).first().click();
}

export async function assertNoPageErrors(page: Page, testInfo: TestInfo) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  void testInfo;
  return errors;
}

export async function attachPageErrors(testInfo: TestInfo, errors: string[]) {
  await testInfo.attach("page-errors", {
    body: Buffer.from(errors.join("\n")),
    contentType: "text/plain",
  });
}

export async function assertNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
}
