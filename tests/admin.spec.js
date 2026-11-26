// The Admin page (js/views/admin.js, pb_migrations/1735000039_admin_page.js,
// pb_hooks/admin.pb.js and users.pb.js): accounts, site details, rooms and
// departments, for admin accounts only - and the server holds the same line.
const { test, expect } = require("@playwright/test");
const { ADMIN, VIEWER, PB, signIn, pickView, apiToken, superuserToken, answer } = require("./helpers");

const EDITOR = { email: "both-editor@example.com", password: "both-dev-pw1" };
const headers = t => ({ Authorization: t });
const stamp = () => Date.now().toString(36);

async function sail(request, token){
  const list = await (await request.get(`${PB}/api/collections/sites/records?filter=code='sail'`, { headers: headers(token) })).json();
  return list.items[0];
}

test("only admin accounts get the Admin page in the menu, on every site and in All", async ({ page }) => {
  await signIn(page, EDITOR);
  await page.click("#view-btn");
  await expect(page.locator("#view-menu [role=option]:has-text('Admin')")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.click("#logout-btn");

  await signIn(page, VIEWER);
  await page.click("#view-btn");
  await expect(page.locator("#view-menu [role=option]:has-text('Admin')")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.click("#logout-btn");

  await signIn(page);
  await pickView(page, "Admin");
  await expect(page.locator("#pane-admin .grouphead")).toHaveCount(2);
  await expect(page.locator("#edit-toggle")).toBeHidden();
  await page.click("#site-btn");
  await page.click("#site-menu [role=option]:has-text('All')");
  await expect(page.locator("#view-label")).toHaveText("Admin");
  await page.click("#site-btn");
  await page.click("#site-menu [role=option]:has-text('SaIL')");
  await pickView(page, "Courses");
  await expect(page.locator("#edit-toggle")).toBeVisible();
});

test("only admins can read or change accounts, rooms, departments or a site", async ({ request }) => {
  for (const account of [VIEWER, EDITOR]) {
    const t = await apiToken(request, account);
    const users = await (await request.get(`${PB}/api/collections/users/records`, { headers: headers(t) })).json();
    expect(users.totalItems || 0).toBe(0);
    const s = await sail(request, t);
    const site = { headers: headers(t), data: { full_name: "Hacked" } };
    expect((await request.patch(`${PB}/api/collections/sites/records/${s.id}`, site)).ok()).toBe(false);
    expect((await request.post(`${PB}/api/collections/rooms/records`, { headers: headers(t), data: { name: "Hacked", site: s.id } })).ok()).toBe(false);
    expect((await request.post(`${PB}/api/collections/users/records`, { headers: headers(t),
      data: { email: "x@example.com", name: "X", role: "admin", password: "password-1", passwordConfirm: "password-1" } })).ok()).toBe(false);
  }
});

test("an admin can't touch a site's code or Eventbrite settings, or add or delete a site", async ({ request }) => {
  const t = await apiToken(request);
  const s = await sail(request, t);
  // What's stored, secrets included, as only a superuser can read it. The
  // server may refuse a hidden field or ignore it: what counts is it stays.
  const su = await superuserToken(request);
  const stored = async () => (await request.get(`${PB}/api/collections/sites/records/${s.id}`, { headers: headers(su) })).json();
  const before = await stored();
  expect(before.code).toBe("sail");
  expect(before).toHaveProperty("eventbrite_staff_code");     // really reading the hidden fields
  for (const data of [{ code: "changed" }, { eventbrite_token: "changed" }, { eventbrite_org: "changed" },
                      { eventbrite_organizer: "changed" }, { eventbrite_venues: [{ id: "1", name: "changed" }] },
                      { eventbrite_staff_code: "changed" }]) {
    await request.patch(`${PB}/api/collections/sites/records/${s.id}`, { headers: headers(t), data });
    const after = await stored();
    const f = Object.keys(data)[0];
    expect(after[f], f).toEqual(before[f]);
  }
  expect((await request.post(`${PB}/api/collections/sites/records`, { headers: headers(t), data: { name: "New", code: "new" } })).ok()).toBe(false);
  expect((await request.delete(`${PB}/api/collections/sites/records/${s.id}`, { headers: headers(t) })).ok()).toBe(false);
  expect(JSON.stringify(s)).not.toContain("eventbrite_token");
});

test("an admin can't lock themselves out", async ({ request }) => {
  const t = await apiToken(request);
  const me = (await (await request.post(`${PB}/api/collections/users/auth-refresh`, { headers: headers(t) })).json()).record;
  const demote = await request.patch(`${PB}/api/collections/users/records/${me.id}`, { headers: headers(t), data: { role: "viewer" } });
  expect(demote.status()).toBe(400);
  expect((await demote.json()).message).toContain("own admin role");
  const del = await request.delete(`${PB}/api/collections/users/records/${me.id}`, { headers: headers(t) });
  expect(del.status()).toBe(400);
});

test("renaming a room carries through to its sessions; one in use can't be deleted", async ({ request }) => {
  const t = await apiToken(request), h = headers(t);
  const s = await sail(request, t);
  const session = (await (await request.get(`${PB}/api/collections/sessions/records?perPage=1&filter=site='${s.id}'`, { headers: h })).json()).items[0];
  const room = (await (await request.get(`${PB}/api/collections/rooms/records?filter=${encodeURIComponent(`site='${s.id}' && name='${session.room}'`)}`, { headers: h })).json()).items[0];

  const del = await request.delete(`${PB}/api/collections/rooms/records/${room.id}`, { headers: h });
  expect(del.status()).toBe(400);
  expect((await del.json()).message).toContain("still use");

  const renamed = `${room.name} ${stamp()}`;
  try {
    expect((await request.patch(`${PB}/api/collections/rooms/records/${room.id}`, { headers: h, data: { name: renamed } })).ok()).toBe(true);
    const after = await (await request.get(`${PB}/api/collections/sessions/records/${session.id}`, { headers: h })).json();
    expect(after.room).toBe(renamed);
  } finally {
    await request.patch(`${PB}/api/collections/rooms/records/${room.id}`, { headers: h, data: { name: room.name } });
  }
  const back = await (await request.get(`${PB}/api/collections/sessions/records/${session.id}`, { headers: h })).json();
  expect(back.room).toBe(room.name);
});

test("Admin page: add an account, change it, sign in with it, delete it", async ({ page }) => {
  const person = { name: `Test Person ${stamp()}`, email: `test-${stamp()}@example.com`, password: "first-password-1" };
  await signIn(page);
  await pickView(page, "Admin");
  await page.click("#pane-admin .grouphead[data-group=accounts]");
  await page.click("#pane-admin [data-add-user]");
  await page.fill("#ad-name", person.name);
  await page.fill("#ad-email", person.email);
  await page.selectOption("#ad-role", "viewer");
  await page.locator("#sheet-panel-account .ticks label:has-text('SaIL') input").check();
  await page.fill("#ad-pw", person.password);
  await page.click("#ad-save");
  await expect(page.locator("#backdrop")).not.toHaveClass(/open/);
  const row = page.locator("#pane-admin .row", { hasText: person.name });
  await expect(row).toContainText("Viewer");
  await expect(row).toContainText(person.email);

  // A new password, then sign in as them.
  await row.click();
  await page.fill("#ad-pw", "second-password-2");
  await page.click("#ad-save");
  await expect(page.locator("#backdrop")).not.toHaveClass(/open/);
  await page.click("#logout-btn");
  await signIn(page, { email: person.email, password: "second-password-2" });
  await page.click("#logout-btn");

  await signIn(page);
  await pickView(page, "Admin");
  await page.click("#pane-admin .grouphead[data-group=accounts]");
  await page.locator("#pane-admin .row", { hasText: person.name }).click();
  await page.click("#ad-del");
  await answer(page, true);
  await expect(page.locator("#backdrop")).not.toHaveClass(/open/);
  await expect(page.locator("#pane-admin .row", { hasText: person.name })).toHaveCount(0);
});

test("your own account: no role to change, no delete button", async ({ page }) => {
  await signIn(page);
  await pickView(page, "Admin");
  await page.click("#pane-admin .grouphead[data-group=accounts]");
  await page.locator("#pane-admin .row", { hasText: "Alex Morgan" }).click();
  await expect(page.locator("#ad-role")).toBeDisabled();
  await expect(page.locator("#ad-del")).toHaveCount(0);
});

test("Admin page: site details and rooms reach the rest of the board", async ({ page, request }) => {
  const room = `Room ${stamp()}`;
  await signIn(page);
  await pickView(page, "Admin");
  await page.click("#pane-admin .grouphead[data-group=sites]");
  await page.locator("#pane-admin .row", { hasText: "CSSC" }).click();
  await page.click("#sheet-tab-rooms");
  await page.fill("#sheet-panel-rooms .ladd input", room);
  await page.click("#sheet-panel-rooms .ladd button");
  const line = page.locator(`#sheet-panel-rooms .lrow:has(input)`).last();
  await expect(line.locator("input")).toHaveValue(room);
  await line.locator("[data-move='-1']").click();
  await expect(page.locator("#sheet-panel-rooms .lrow").last().locator("input")).not.toHaveValue(room);

  // Back to the end, and gone again.
  await page.locator(`#sheet-panel-rooms .lrow`, { has: page.locator(`input`) }).nth(-2).locator("[data-del]").click();
  await answer(page, true);
  await expect(page.locator("#sheet-panel-rooms .lrow input").last()).not.toHaveValue(room);

  await page.click("#sheet-tab-site");
  const was = await page.inputValue("#ad-sfull");
  await page.fill("#ad-sfull", "Changed by a test");
  await page.click("#ad-ssave");
  await expect(page.locator("#ad-sstatus")).toHaveText("Saved.");
  await page.fill("#ad-sfull", was);
  await page.click("#ad-ssave");
  await expect(page.locator("#ad-sstatus")).toHaveText("Saved.");
  await page.click("#sheet-close");
  await expect(page.locator("#backdrop")).not.toHaveClass(/open/);
});
