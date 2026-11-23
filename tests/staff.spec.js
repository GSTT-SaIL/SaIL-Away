// Staff (pb_migrations/1735000026_staff.js): each person's leave, grouped
// by person, on their home site's page. Accounts and sample leave from the
// dev seeds (1735000022, 1735000027): SaIL - Alex Morgan (admin), Sam
// Taylor, Jordan Bell; CSSC - Casey Lane, Robin Hart.
const { test, expect } = require("@playwright/test");
const { ADMIN, VIEWER, PB, signIn, pickView, apiToken, answer, expandAll } = require("./helpers");

const CSSC_VIEWER = { email: "cssc-viewer@example.com", password: "cssc-dev-pw2" };
const BOTH_EDITOR = { email: "both-editor@example.com", password: "both-dev-pw1" };
const auth = t => ({ headers: { Authorization: t } });

test("each site's Staff page lists its own people, with their leave", async ({ page }) => {
  await signIn(page, VIEWER);
  await pickView(page, "Staff");
  const heads = page.locator("#pane-staff .grouphead");
  await expect(heads.first()).toBeVisible();
  await expect(heads).toHaveCount(3);
  await expect(page.locator("#pane-staff")).toContainText("Alex Morgan");
  await expect(page.locator("#pane-staff")).not.toContainText("Casey Lane");
  await expect(page.locator("#edit-toggle")).toBeHidden();
  // Headers in the site's colour, not grey; no site pill outside All.
  expect(await heads.first().evaluate(h => h.style.getPropertyValue("--gink"))).toMatch(/^#[0-9a-f]{6}$/i);
  await expect(page.locator("#pane-staff .grouphead .sitetag")).toHaveCount(0);

  await heads.filter({ hasText: "Alex Morgan" }).click();
  const rows = page.locator("#pane-staff .row.leave");
  await expect(rows.filter({ hasText: "Annual leave" }).first()).toBeVisible();
  await expect(rows.filter({ hasText: "13:00–17:00" })).toHaveCount(1);        // an hours entry
  await expect(rows.filter({ hasText: "5 days" })).toHaveCount(1);             // a whole-day range

  await page.click("#logout-btn");
  await signIn(page, CSSC_VIEWER);
  await pickView(page, "Staff");
  await expect(page.locator("#pane-staff .grouphead")).toHaveCount(2);
  await expect(page.locator("#pane-staff")).toContainText("Casey Lane");
  await expect(page.locator("#pane-staff")).not.toContainText("Alex Morgan");
});

test("admins add, change and delete leave; hours mean a single day", async ({ page }) => {
  await signIn(page);
  await pickView(page, "Staff");
  await page.locator("#pane-staff .grouphead", { hasText: "Jordan Bell" }).click();
  await page.click("#edit-toggle");
  const before = await page.locator("#pane-staff .row.leave").count();
  await page.click('#pane-staff [data-add-leave]');
  const row = page.locator("#pane-staff .row.leave").last();
  await expect(page.locator("#pane-staff .row.leave")).toHaveCount(before + 1);

  await row.locator('[data-f="kind"]').selectOption("wfh");
  await row.locator('[data-f="hours"]').check();
  await expect(row.locator(".oneday")).toHaveText("Same day");
  await expect(row.locator('[data-f="from"]')).toHaveValue("09:00");
  await row.locator('[data-f="to"]').fill("15:30");
  await row.locator('[data-f="to"]').blur();
  const note = "Working from home in the morning, then at the dentist; back online by four to finish the rota";
  await row.locator('[data-f="note"]').fill(note);
  await row.locator('[data-f="note"]').blur();

  await page.click("#edit-toggle");
  const done = page.locator("#pane-staff .row.leave", { hasText: "09:00–15:30" });
  await expect(done).toHaveCount(1);
  await expect(done).toContainText("WFH");
  // A long note is cut short in its cell, and pops out in full on hover.
  const cell = done.locator(".ntext");
  await expect(cell).toHaveText(note);
  expect(await cell.evaluate(el => el.scrollWidth > el.clientWidth)).toBeTruthy();
  await cell.hover();
  await expect(page.locator(".notepop")).toBeVisible();
  await expect(page.locator(".notepop")).toHaveText(note);
  await page.mouse.move(5, 5);
  await expect(page.locator(".notepop")).toBeHidden();

  // Delete it again.
  await page.click("#edit-toggle");
  await page.locator("#pane-staff .row.leave").last().locator("[data-del-leave]").click();
  await answer(page, true);
  await expect(page.locator("#pane-staff .row.leave")).toHaveCount(before);
});

test("leave: only admins write; the server checks dates, hours and the person's site", async ({ request }) => {
  const login = async a => (await (await request.post(`${PB}/api/collections/users/auth-with-password`,
    { data: { identity: a.email, password: a.password } })).json());
  const admin = await login(ADMIN), viewer = await login(VIEWER);
  const editor = await apiToken(request, BOTH_EDITOR);
  const url = `${PB}/api/collections/leave/records`;
  const day = new Date().toISOString().slice(0, 10);
  const ok = { person: viewer.record.id, kind: "wfh", start: day, end: day, from: "", to: "" };

  // Not editors, not viewers.
  expect((await request.post(url, { ...auth(editor), data: ok })).ok()).toBeFalsy();
  expect((await request.post(url, { ...auth(viewer.token), data: ok })).ok()).toBeFalsy();
  // Hours on more than one day, one hour without the other, ending first: no.
  const next = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  for (const bad of [{ end: next, from: "09:00", to: "12:00" }, { from: "09:00" }, { from: "12:00", to: "09:00" }, { start: next, end: day }])
    expect((await request.post(url, { ...auth(admin.token), data: { ...ok, ...bad } })).status(), JSON.stringify(bad)).toBe(400);
  // A good one is filed under the person's home site, whatever was sent.
  const res = await request.post(url, { ...auth(admin.token), data: ok });
  expect(res.ok()).toBeTruthy();
  const rec = await res.json();
  const sites = (await (await request.get(`${PB}/api/collections/sites/records`, auth(admin.token))).json()).items;
  expect(rec.site).toBe(sites.find(s => s.code === "sail").id);
  await request.delete(`${url}/${rec.id}`, auth(admin.token));

  // The people list carries names, never emails.
  const people = (await (await request.get(`${PB}/api/collections/staff/records`, auth(viewer.token))).json()).items;
  expect(people.length).toBeGreaterThan(0);
  for (const p of people) expect(Object.keys(p).sort()).toEqual(["collectionId", "collectionName", "id", "name", "site"]);
});

test("Rota: the Timetable's grid with the site's staff as rows, showing their leave", async ({ page }) => {
  await signIn(page, VIEWER);
  await pickView(page, "Rota");
  await expect(page.locator("#ro .corner")).toHaveText("Staff");
  const names = (await page.locator("#ro .room").allInnerTexts()).map(t => t.split("\n")[0].trim());
  expect(names).toEqual(["Alex Morgan", "Jordan Bell", "Sam Taylor"]);          // SaIL's people, by name
  await expect(page.locator("#rowpick-btn")).toHaveText("All people");
  await expect(page.locator("#legend-ro")).toContainText("Annual leave");
  // The sample leave is this week and next: some of it is on the grid.
  expect(await page.locator("#ro .blk").count()).toBeGreaterThan(0);
  await expect(page.locator("#ro .blk.hatch", { hasText: "Annual leave" }).first()).toBeAttached();   // leave is hatched
});

test("Allocate: staff from the session's site, shown on the Rota as filled boxes", async ({ page, request }) => {
  await signIn(page);
  await expandAll(page, "pane-courses");
  const session = page.locator("#rows .row.session[data-open]").first();
  const sid = await session.getAttribute("data-open");
  await session.click();
  await page.click("#sheet-tab-allocate");
  await page.fill("#alloc-q", "Sam");
  await expect(page.locator("#alloc-sugg")).toContainText("Sam Taylor");
  await expect(page.locator("#alloc-sugg")).not.toContainText("Casey Lane");   // CSSC's, not this site's
  await page.press("#alloc-q", "Enter");
  await expect(page.locator("#backdrop .alloclist")).toContainText("Sam Taylor");
  await expect(page.locator("#sheet-tab-allocate .fcount")).toHaveText("1");
  await page.click("#sheet-close");

  await pickView(page, "Rota");
  await expect(page.locator("#ro .blk:not(.hatch)").first()).toBeAttached();   // allocations are filled
  await expect(page.locator("#legend-ro")).toContainText("Allocated to a course");

  // The server refuses someone from another site.
  const admin = await (await request.post(`${PB}/api/collections/users/auth-with-password`,
    { data: { identity: ADMIN.email, password: ADMIN.password } })).json();
  const casey = (await (await request.get(`${PB}/api/collections/staff/records?filter=${encodeURIComponent('name = "Casey Lane"')}`, auth(admin.token))).json()).items[0];
  expect((await request.patch(`${PB}/api/collections/sessions/records/${sid}`, { ...auth(admin.token), data: { "staff+": casey.id } })).status()).toBe(400);
  // Leave the data as it was.
  await request.patch(`${PB}/api/collections/sessions/records/${sid}`, { ...auth(admin.token), data: { staff: [] } });
});
