// Sign-in, "keep me signed in", roles and sign-out.
const { test, expect } = require("@playwright/test");
const { ADMIN, VIEWER, signIn } = require("./helpers");

test("nothing is shown before sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#login-backdrop")).toHaveClass(/open/);
  await expect(page.locator(".app")).toBeHidden();
});

test("wrong password is rejected", async ({ page }) => {
  await page.goto("/");
  await page.fill("#login-email", ADMIN.email);
  await page.fill("#login-password", "definitely-not-the-password");
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/authed/);
});

test("reload keeps you signed in, without showing the sign-in dialog", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/authed/);
  await expect(page.locator("#login-backdrop")).not.toHaveClass(/open/);
});

test("unticked: a new tab must sign in again", async ({ page, context }) => {
  await signIn(page, ADMIN, { remember: false });
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator("#login-backdrop")).toHaveClass(/open/);
  await expect(other.locator("body")).not.toHaveClass(/authed/);
});

test("ticked: a new tab is already signed in", async ({ page, context }) => {
  await signIn(page, ADMIN, { remember: true });
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator("body")).toHaveClass(/authed/);
  await expect(other.locator("#login-backdrop")).not.toHaveClass(/open/);
});

test("admin sees Edit, viewer does not", async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page.locator("#edit-toggle")).toBeVisible();
  await page.click("#logout-btn");
  await signIn(page, VIEWER);
  await expect(page.locator("#edit-toggle")).toBeHidden();
});

test("sign-out clears every view's data from the page", async ({ page }) => {
  await signIn(page);
  await page.click("#logout-btn");
  await expect(page.locator("#login-backdrop")).toHaveClass(/open/);
  for (const id of ["rows", "tt", "ro", "legend-b", "legend-ro", "staff-rows", "app-cards", "count", "tk-grid", "tk-month", "tk-status"]) {
    await expect(page.locator(`#${id}`), id).toBeEmpty();
  }
});
