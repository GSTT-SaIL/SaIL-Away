// Shared test helpers.
//
// Accounts default to the dev seed accounts (see README / the dev seed) and
// can be overridden with environment variables when testing elsewhere.
const { expect } = require("@playwright/test");

const ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL || "editor@example.com",
  password: process.env.TEST_ADMIN_PASSWORD || "editor-dev-pw1",
};
const VIEWER = {
  email: process.env.TEST_VIEWER_EMAIL || "viewer@example.com",
  password: process.env.TEST_VIEWER_PASSWORD || "viewer-dev-pw1",
};

// Each person's site and year are remembered on their account
// (js/core/prefs.js), so a test that switched them would change where the
// next test opens. Every sign-in starts from the defaults - SaIL, this
// year - unless keepPlace is set (to test that they're remembered).
// Their room settings are left alone: the tests that change them put them back.
async function resetPlace(page, account){
  const PB_URL = process.env.PB_URL || "http://localhost:8090";
  const res = await page.request.post(`${PB_URL}/api/collections/users/auth-with-password`,
    { data: { identity: account.email, password: account.password } });
  if (!res.ok()) return;
  const { token } = await res.json();
  const list = await (await page.request.get(`${PB_URL}/api/collections/user_prefs/records`, { headers: { Authorization: token } })).json();
  const row = list.items?.[0];
  if (!row || !row.data || !("site" in row.data || "fy" in row.data)) return;
  const { site, fy, ...rest } = row.data;
  await page.request.patch(`${PB_URL}/api/collections/user_prefs/records/${row.id}`,
    { headers: { Authorization: token }, data: { data: rest } });
}

async function signIn(page, account = ADMIN, { remember = false, keepPlace = false } = {}) {
  if (!keepPlace) await resetPlace(page, account);
  await page.goto("/");
  await expect(page.locator("#login-backdrop")).toHaveClass(/open/);
  await page.fill("#login-email", account.email);
  await page.fill("#login-password", account.password);
  if (remember) await page.check("#login-remember");
  await page.click("#login-submit");
  await expect(page.locator("body")).toHaveClass(/authed/);
  await expect(page.locator("#count")).toHaveText(/\d+ courses, \d+ sessions/);
}

// Picks a view from the top-bar menu, the way a user would.
async function pickView(page, label) {
  await page.click("#view-btn");
  await page.click(`#view-menu [role=option]:has-text("${label}")`);
  await expect(page.locator("#view-label")).toHaveText(label);
}

// Grouped boards start fully collapsed; this waits for the board's groups
// to load, then opens everything with the top bar's Expand all.
async function expandAll(page, pane) {
  await expect(page.locator(`#${pane} .grouphead`).first()).toBeVisible();
  await page.click("#collapse-all");
  await expect(page.locator("#collapse-all")).toHaveText("Collapse all");
}

const PB = process.env.PB_URL || "http://localhost:8090";

// API token for a board account.
async function apiToken(request, account = ADMIN){
  const res = await request.post(`${PB}/api/collections/users/auth-with-password`,
    { data: { identity: account.email, password: account.password } });
  return (await res.json()).token;
}

// The account's display name (users.name - every account has one since
// 1735000016), as the board shows it in place of the email.
async function accountName(request, account = ADMIN){
  const res = await request.post(`${PB}/api/collections/users/auth-with-password`,
    { data: { identity: account.email, password: account.password } });
  return (await res.json()).record.name;
}

// A site's id by its code ("sail", "cssc") - records the tests make
// through the API need one (pb_migrations/1735000021_sites.js).
async function siteIdOf(request, token, code = "sail"){
  const res = await request.get(`${PB}/api/collections/sites/records?filter=${encodeURIComponent(`code = "${code}"`)}`,
    { headers: { Authorization: token } });
  return (await res.json()).items[0]?.id;
}

// Superuser token, from the PB_ADMIN_* values in .env - used only to clean
// up records the tests create that the board itself won't delete (issued
// invoices). Returns null if .env can't be read.
async function superuserToken(request){
  let env = {};
  try{
    const text = require("fs").readFileSync(require("path").join(__dirname, "..", ".env"), "utf8");
    for(const m of text.matchAll(/^(\w+)=(.*)$/gm)) env[m[1]] = m[2].trim();
  }catch{ return null; }
  const res = await request.post(`${PB}/api/collections/_superusers/auth-with-password`,
    { data: { identity: env.PB_ADMIN_EMAIL, password: env.PB_ADMIN_PASSWORD } });
  return res.ok() ? (await res.json()).token : null;
}

// Answer the board's in-app confirm dialog (js/core/dialog.js), checking
// its message if `contains` is given.
async function answer(page, ok = true, contains){
  await expect(page.locator("#dialog")).toHaveClass(/\bopen\b/);
  if(contains) await expect(page.locator("#dialog-msg")).toContainText(contains);
  await page.click(ok ? "#dialog-ok" : "#dialog-cancel");
  await expect(page.locator("#dialog")).not.toHaveClass(/\bopen\b/);
}

module.exports = { ADMIN, VIEWER, PB, signIn, pickView, expandAll, apiToken, accountName, superuserToken, siteIdOf, answer };
