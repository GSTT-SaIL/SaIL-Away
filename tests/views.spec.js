// The view picker, the Timetable and Rota grids and the Tickets view.
const { test, expect } = require("@playwright/test");
const { signIn, pickView, VIEWER } = require("./helpers");

test.beforeEach(async ({ page }) => { await signIn(page); });

test("no script errors while using every view", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if(m.type() === "error") errors.push(m.text()); });
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/authed/);
  for (const label of ["Timetable", "Rota", "Tickets", "Invoices", "Forms", "Staff", "Apps", "Courses"]) await pickView(page, label);
  await page.click("#edit-toggle");
  await page.click("#edit-toggle");
  await page.click("#logout-btn");
  await expect(page.locator("#login-backdrop")).toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test("view picker shows each view with the right toolbar", async ({ page }) => {
  const cases = [
    // rows = the rooms tick-list, which replaces the filter on the calendars.
    { label: "Timetable",    pane: "#pane-timetable",    week: true,  expand: false, filter: false, rows: true  },
    { label: "Rota",         pane: "#pane-rota",         week: true,  expand: false, filter: false, rows: true  },
    { label: "Tickets",      pane: "#pane-tickets",      week: false, expand: false, filter: false, rows: false },
    { label: "Invoices",     pane: "#pane-invoices",     week: false, expand: true,  filter: true,  rows: false },
    { label: "Forms",        pane: "#pane-forms",        week: false, expand: true,  filter: true,  rows: false },
    { label: "Staff",        pane: "#pane-staff",        week: false, expand: true,  filter: true,  rows: false },
    { label: "Apps",         pane: "#pane-apps",         week: false, expand: false, filter: true,  rows: false },
    { label: "Courses",      pane: "#pane-courses",      week: false, expand: true,  filter: true,  rows: false },
  ];
  for (const c of cases) {
    await pickView(page, c.label);
    await expect(page.locator(".pane.on")).toHaveCount(1);
    await expect(page.locator(c.pane)).toHaveClass(/\bon\b/);
    await expect(page.locator("#tb-timetable"), c.label + " week stepper")[c.week ? "toBeVisible" : "toBeHidden"]();
    await expect(page.locator("#collapse-all"), c.label + " expand all")[c.expand ? "toBeVisible" : "toBeHidden"]();
    await expect(page.locator("#q"), c.label + " filter")[c.filter ? "toBeVisible" : "toBeHidden"]();
    await expect(page.locator("#rowpick"), c.label + " rooms list")[c.rows ? "toBeVisible" : "toBeHidden"]();
  }
});

test("grouped boards open with every group and item collapsed", async ({ page }) => {
  for (const [label, pane] of [["Courses", "#pane-courses"], ["Invoices", "#pane-invoices"], ["Forms", "#pane-forms"], ["Staff", "#pane-staff"]]) {
    await pickView(page, label);
    await expect(page.locator(`${pane} .grouphead`).first(), label).toBeVisible();
    await expect(page.locator(`${pane} .grouphead[aria-expanded="true"]`), label).toHaveCount(0);
    await expect(page.locator(`${pane} .gcard`), label).toHaveCount(0);
    await expect(page.locator("#collapse-all"), label).toHaveText("Expand all");
  }
});

test("the view on show is in the address, and comes back after a reload", async ({ page }) => {
  await expect(page).toHaveURL(/#courses$/);
  await pickView(page, "Rota");
  await expect(page).toHaveURL(/#rota$/);
  const before = await page.evaluate(() => history.length);
  await pickView(page, "Staff");
  expect(await page.evaluate(() => history.length)).toBe(before);       // replaced, not added: Back still leaves
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/authed/);
  await expect(page.locator("#view-label")).toHaveText("Staff");
  await page.evaluate(() => { location.hash = "#timetable"; });
  await expect(page.locator("#view-label")).toHaveText("Timetable");
});

test("view picker works from the keyboard", async ({ page }) => {
  await page.focus("#view-btn");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#view-menu")).toBeVisible();
  await page.keyboard.press("End");             // Admin, the last view
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator("#view-menu")).toBeHidden();
  await expect(page.locator("#view-label")).toHaveText("Tickets");
  await page.focus("#view-btn");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.locator("#view-menu")).toBeHidden();
  await expect(page.locator("#view-label")).toHaveText("Tickets");
});

test("timetable steps through weeks and opens a booking", async ({ page }) => {
  await pickView(page, "Timetable");
  const label = page.locator("#week-label");
  const first = await label.textContent();
  await page.click("#next-week");
  await expect(label).not.toHaveText(first);
  await page.click("#this-week");
  await expect(label).toHaveText(first);
  // Find a week with a booking (sample data is spread over a few months).
  for (let i = 0; i < 12 && await page.locator("#tt .blk").count() === 0; i++) await page.click("#next-week");
  await page.locator("#tt .blk").first().click();
  await expect(page.locator("#backdrop")).toHaveClass(/open/);
});

test("board and public page use the same room list", async ({ page, request }) => {
  const api = await (await request.get((process.env.PB_URL || "http://localhost:8090") + "/api/availability")).json();
  await pickView(page, "Timetable");
  const rows = (await page.locator("#tt .room").allInnerTexts()).map(t => t.split("\n")[0].trim());
  expect(rows).toEqual(api.rooms);
});

test("rooms tick-list: hides rooms from your own view only, and remembers them", async ({ page }) => {
  const saved = () => page.waitForResponse(r => r.url().includes("/user_prefs/records") && r.request().method() !== "GET");
  await pickView(page, "Timetable");
  const rooms = page.locator("#tt .room");
  await expect(rooms.first()).toBeVisible();
  const n = await rooms.count();
  await expect(page.locator("#rowpick-btn")).toHaveText("All rooms");

  // Untick the first room: gone from both calendars, and the button says so.
  await page.click("#rowpick-btn");
  const first = page.locator("#rowpick-menu .tickrow:not(.tickall)").first();
  const name = (await first.innerText()).trim();
  let save = saved();
  await first.locator("input").uncheck();
  await save;
  await expect(rooms).toHaveCount(n - 1);
  await expect(page.locator("#tt .room", { hasText: name })).toHaveCount(0);
  await expect(page.locator("#rowpick-btn")).toHaveText(`${n - 1} of ${n} rooms`);
  await expect(page.locator("#rowpick-btn")).toHaveClass(/filtered/);
  await expect(page.locator("#rowpick-menu input[data-all]")).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.locator("#rowpick-menu")).toBeHidden();

  // Someone else's view is untouched.
  await page.click("#logout-btn");
  await signIn(page, VIEWER);
  await pickView(page, "Timetable");
  await expect(page.locator("#tt .room")).toHaveCount(n);
  await expect(page.locator("#rowpick-btn")).toHaveText("All rooms");

  // Back as the first person, on a fresh sign-in: still hidden.
  await page.click("#logout-btn");
  await signIn(page);
  await pickView(page, "Timetable");
  await expect(page.locator("#tt .room")).toHaveCount(n - 1);

  // Select all brings everything back (and leaves the data as it was).
  await page.click("#rowpick-btn");
  save = saved();
  await page.locator("#rowpick-menu input[data-all]").check();
  await save;
  await expect(page.locator("#tt .room")).toHaveCount(n);
  await expect(page.locator("#rowpick-btn")).toHaveText("All rooms");
  await expect(page.locator("#rowpick-btn")).not.toHaveClass(/filtered/);
});

test("room arrows: move a room in your own order only, and remember it", async ({ page }) => {
  const saved = () => page.waitForResponse(r => r.url().includes("/user_prefs/records") && r.request().method() !== "GET");
  const names = async grid => (await page.locator(`${grid} .room`).allInnerTexts()).map(t => t.split("\n")[0].trim());
  await pickView(page, "Timetable");
  await expect(page.locator("#tt .room").first()).toBeVisible();
  const before = await names("#tt");

  // Hidden until hovered; the first room can't go up.
  const first = page.locator("#tt .room").first();
  await expect(first.locator(".rmove")).toBeHidden();
  await first.hover();
  await expect(first.locator('[data-move="-1"]')).toBeVisible();
  await expect(first.locator('[data-move="-1"]')).toBeDisabled();

  // Down: the first two swap, in both calendars and the rooms list.
  let save = saved();
  await first.locator('[data-move="1"]').click();
  await save;
  const swapped = [before[1], before[0], ...before.slice(2)];
  expect(await names("#tt")).toEqual(swapped);
  await page.click("#rowpick-btn");
  expect((await page.locator("#rowpick-menu .tickrow:not(.tickall)").allInnerTexts()).map(t => t.trim())).toEqual(swapped);
  await page.keyboard.press("Escape");

  // Someone else's order is untouched; ours survives signing in again.
  await page.click("#logout-btn");
  await signIn(page, VIEWER);
  await pickView(page, "Timetable");
  expect(await names("#tt")).toEqual(before);
  await page.click("#logout-btn");
  await signIn(page);
  await pickView(page, "Timetable");
  expect(await names("#tt")).toEqual(swapped);

  // Up puts it back.
  const second = page.locator("#tt .room").nth(1);
  await second.hover();
  save = saved();
  await second.locator('[data-move="-1"]').click();
  await save;
  expect(await names("#tt")).toEqual(before);
});

test("banner: no Site/Year labels; its tab hides it to a sliver, remembered for the person", async ({ page }) => {
  const saved = () => page.waitForResponse(r => r.url().includes("/user_prefs/records") && r.request().method() !== "GET");
  for (const id of ["#fy-label", "#site-label"])                     // read by screen readers only
    expect((await page.locator(id).boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
  const tab = page.locator("#banner-toggle");
  await expect(tab).toHaveCSS("opacity", "0");
  await page.locator(".banner").hover();
  await expect(tab).toHaveCSS("opacity", "1");

  let save = saved();
  await tab.click();
  await save;
  await expect(page.locator("body")).toHaveClass(/banner-hidden/);
  await expect(tab).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#fy-btn")).toBeHidden();
  await expect.poll(async () => (await page.locator(".banner").boundingBox()).height).toBeLessThanOrEqual(30);   // 12px sliver + 18px under the board

  // Still hidden after signing in again; the tab brings it back.
  await page.click("#logout-btn");
  await signIn(page);
  await expect(page.locator("body")).toHaveClass(/banner-hidden/);
  save = saved();
  await tab.click();
  await save;
  await expect(page.locator("body")).not.toHaveClass(/banner-hidden/);
  await expect(page.locator("#fy-btn")).toBeVisible();
});

test("the public availability page is reached from the Timetable's link (not in All)", async ({ page, context }) => {
  await pickView(page, "Timetable");
  await expect(page.locator("#view-menu [role=option]", { hasText: "Availability" })).toHaveCount(0);   // no board view
  const btn = page.locator("#share-av");
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText("Copy availability link");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await btn.click();
  await expect(page.locator("#share-av-done")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/availability\.html\?site=sail$/);
  await page.click("#site-btn");
  await page.click('#site-menu [role=option]:has-text("All")');
  await expect(page.locator("#site-value")).toHaveText("All");
  await expect(btn).toBeHidden();
});


test("tickets: month calendar, events open a pop-up with attendees (or a clear error)", async ({ page }) => {
  await pickView(page, "Tickets");
  await expect(page.locator("#tk-create")).toBeVisible();                     // admins and editors (the form: ebcreate.spec.js)
  await expect(page.locator("#tk-month")).toHaveText(/\w+ \d{4}/);
  await expect(page.locator("#tk-status")).not.toContainText("Loading events");
  // The year as twelve month pages side by side, each 7 day names and six
  // whole weeks, every page the same size.
  await expect(page.locator("#tk-loading")).toBeHidden();
  await expect(page.locator("#tk-grid .tkcal")).toHaveCount(12);
  await expect(page.locator("#tk-grid .tkcal").first().locator(".h")).toHaveCount(7);
  await expect(page.locator("#tk-grid .tkcal").first().locator(".cell")).toHaveCount(42);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll("#tk-grid .tkcal")].map(p => Math.round(p.getBoundingClientRect().width) + "x" + Math.round(p.getBoundingClientRect().height)));
  expect(new Set(sizes).size).toBe(1);

  // Month stepping: the arrows glide a month sideways and lock there.
  const month = await page.locator("#tk-month").textContent();
  await page.click("#tk-next");
  await expect(page.locator("#tk-month")).not.toHaveText(month);
  await page.click("#tk-prev");
  await expect(page.locator("#tk-month")).toHaveText(month);

  if (await page.locator("#tk-grid .tkev").count() === 0) {
    // Nothing this month: either there are no events at all, or Eventbrite
    // couldn't be reached - both say so.
    const status = await page.locator("#tk-status").textContent();
    if (status) expect(status).toMatch(/Could not load|No upcoming/);
    return;
  }
  const ev = page.locator("#tk-grid .tkev").first();
  const name = (await ev.locator(".bt").innerText()).trim();
  await ev.click();
  await expect(page.locator("#backdrop")).toHaveClass(/open/);
  await expect(page.locator("#sheet-title")).toHaveText(name);
  await expect(page.locator("#sheet-tab-details")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sheet-body")).toContainText("Date");
  await expect(page.locator("#sheet-tab-notes")).toBeHidden();
  await page.click("#sheet-tab-attendees");
  const att = page.locator("#sheet-panel-attendees .fbody");
  await expect(att).not.toContainText("Loading attendees");
  await expect(att).toContainText(/signed up|No one has signed up|Could not load/);
  await page.click("#sheet-close");
});
