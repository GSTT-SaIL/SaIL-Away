// Courses view: browsing, filtering, the detail sheet and admin editing.
const { test, expect } = require("@playwright/test");
const { signIn, VIEWER, PB, apiToken, accountName, answer } = require("./helpers");

test.beforeEach(async ({ page }) => { await signIn(page); });

test("groups and courses expand and collapse", async ({ page }) => {
  const group = page.locator(".grouphead").first();
  await expect(group).toHaveAttribute("aria-expanded", "false");
  await group.click();
  await expect(group).toHaveAttribute("aria-expanded", "true");
  // Only the chevron button expands a course (the rest of the row opens it).
  const exp = page.locator(".row.course .exp").first();
  await expect(exp).toHaveAttribute("aria-expanded", "false");
  await exp.click();
  await expect(page.locator(".row.course .exp").first()).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".row.session").first()).toBeVisible();
  await expect(page.locator("#backdrop")).not.toHaveClass(/open/);
});

test("Expand all / Collapse all", async ({ page }) => {
  await page.click("#collapse-all");
  await expect(page.locator("#collapse-all")).toHaveText("Collapse all");
  const courses = await page.locator(".row.course").count();
  expect(courses).toBeGreaterThan(0);
  await expect(page.locator('.row.course .exp[aria-expanded="false"]')).toHaveCount(0);
  await page.click("#collapse-all");
  await expect(page.locator(".row.course")).toHaveCount(0);
});

test("filter narrows the list and shows an empty state", async ({ page }) => {
  const total = await page.locator("#count").textContent();
  await page.fill("#q", "zzzz-no-such-thing");
  await expect(page.locator("#rows .empty")).toContainText("Nothing matches");
  await expect(page.locator("#count")).toHaveText("0 courses, 0 sessions");
  await page.fill("#q", "");
  await expect(page.locator("#count")).toHaveText(total);
});

test("clicking a course row opens its pop-up without expanding it", async ({ page }) => {
  await page.click("#collapse-all");   // expand all
  await page.click("#collapse-all");   // collapse all: groups closed
  await page.locator(".grouphead").first().click();
  const course = page.locator(".row.course").first();
  const title = (await course.locator(".ctitle").innerText()).trim();
  await course.locator(".ctitle").click();
  await expect(page.locator("#backdrop")).toHaveClass(/open/);
  await expect(page.locator("#sheet-title")).toHaveText(title);
  await expect(page.locator("#sheet-tab-details")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#backdrop")).not.toHaveClass(/open/);
  await expect(course.locator(".exp")).toHaveAttribute("aria-expanded", "false");

  // The email link in the row is still just a link.
  await course.locator("a[href^='mailto:']").evaluate(a => a.addEventListener("click", e => e.preventDefault()));
  await course.locator("a[href^='mailto:']").click();
  await expect(page.locator("#backdrop")).not.toHaveClass(/open/);

  // Keyboard: Enter on a focused row opens it too.
  await course.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#backdrop")).toHaveClass(/open/);
  await page.keyboard.press("Escape");
});

test("viewers can read notes but not write them", async ({ page, request }) => {
  // An admin's note on the first session, for the viewer to read.
  const admin = await apiToken(request);
  const sessions = await (await request.get(`${PB}/api/collections/sessions/records?perPage=1&sort=sort`,
    { headers: { Authorization: admin } })).json();
  const sid = sessions.items[0].id;
  const made = await (await request.post(`${PB}/api/collections/session_notes/records`,
    { headers: { Authorization: admin }, data: { session: sid, title: "E2E read-only note", body: "<p>Hello</p>" } })).json();
  try{
    await page.click("#logout-btn");
    await signIn(page, VIEWER);
    await page.click("#collapse-all");
    await page.locator(`.row.session[data-open="${sid}"]`).click();
    await page.click("#sheet-tab-notes");
    await page.locator("#note-list .noteitem", { hasText: "E2E read-only note" }).click();
    await expect(page.locator("#note-input")).toHaveText("Hello");
    await expect(page.locator("#note-input")).toHaveAttribute("contenteditable", "false");
    await expect(page.locator("#note-title")).toHaveAttribute("readonly", "");
    await expect(page.locator("#note-toolbar")).toBeHidden();
    await expect(page.locator("#note-new")).toBeHidden();
    await expect(page.locator("#note-delete")).toBeHidden();
    await page.click("#sheet-close");

    // And the API refuses a viewer's note.
    const viewer = await apiToken(request, VIEWER);
    const res = await request.post(`${PB}/api/collections/session_notes/records`,
      { headers: { Authorization: viewer }, data: { session: sid, body: "E2E viewer note" } });
    expect(res.ok()).toBeFalsy();
  }finally{
    await request.delete(`${PB}/api/collections/session_notes/records/${made.id}`, { headers: { Authorization: admin } });
  }
});

test("admins add several titled notes, stamped with their author's name", async ({ page, request }) => {
  const name = await accountName(request);
  await page.click("#collapse-all");
  await page.locator(".row.course .ctitle").first().click();
  await page.click("#sheet-tab-notes");
  const before = await page.locator("#note-list .noteitem").count();

  for (const title of ["E2E first note", "E2E second note"]) {
    await page.click("#note-new");
    await expect(page.locator("#note-title")).toBeFocused();
    await page.keyboard.type(title);
    await page.click("#note-input");
    await page.keyboard.type("Body of " + title);
    await expect(page.locator("#note-status")).toHaveText("Saved");
  }
  await expect(page.locator("#note-list .noteitem")).toHaveCount(before + 2);
  // Newest first, each with who wrote it.
  await expect(page.locator("#note-list .noteitem").first()).toContainText("E2E second note");
  await expect(page.locator("#note-list .noteitem").first()).toContainText(name);
  await expect(page.locator("#note-meta")).toContainText("Created by " + name);
  await expect(page.locator("#sheet-panel-notes")).not.toContainText("@");   // a name, not an email

  // Both survive a reload, then are deleted (after the in-app confirm).
  await page.reload();
  await expect(page.locator("#count")).toHaveText(/\d+ courses/);
  await page.click("#collapse-all");
  await page.locator(".row.course .ctitle").first().click();
  await page.click("#sheet-tab-notes");
  for (const title of ["E2E first note", "E2E second note"]) {
    await page.locator("#note-list .noteitem", { hasText: title }).click();
    await expect(page.locator("#note-input")).toHaveText("Body of " + title);
    await page.click("#note-delete");
    await answer(page, true, title);
    await expect(page.locator("#note-list .noteitem", { hasText: title })).toHaveCount(0);
  }
  await expect(page.locator("#note-list .noteitem")).toHaveCount(before);
});

test("a note's author is set by the server, not the request", async ({ request }) => {
  const admin = await apiToken(request);
  const name = await accountName(request);
  const courses = await (await request.get(`${PB}/api/collections/courses/records?perPage=1`,
    { headers: { Authorization: admin } })).json();
  const res = await request.post(`${PB}/api/collections/course_notes/records`, { headers: { Authorization: admin },
    data: { course: courses.items[0].id, title: "E2E spoof", author_name: "Someone else" } });
  const note = await res.json();
  try{
    expect(note.author_name).toBe(name);
    const upd = await (await request.patch(`${PB}/api/collections/course_notes/records/${note.id}`,
      { headers: { Authorization: admin }, data: { author_name: "Someone else" } })).json();
    expect(upd.author_name).toBe(name);
  }finally{
    await request.delete(`${PB}/api/collections/course_notes/records/${note.id}`, { headers: { Authorization: admin } });
  }
});

test("clicking a session opens its details, with Allocate and Notes tabs", async ({ page }) => {
  await page.click("#collapse-all");
  await page.locator(".row.session").first().click();
  await expect(page.locator("#backdrop")).toHaveClass(/open/);
  await expect(page.locator("#sheet-tab-details")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#sheet-body")).toContainText("Room");
  await expect(page.locator("#sheet-tab-attendees")).toBeHidden();   // Tickets only
  await expect(page.locator("#sheet-panel-notes")).toBeHidden();
  await page.click("#sheet-tab-notes");
  await expect(page.locator("#sheet-panel-notes")).toBeVisible();
  await expect(page.locator("#sheet-body")).toBeHidden();
  // Arrow keys move along the tabs too: Notes -> Allocate -> Details.
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#sheet-tab-allocate")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#sheet-tab-details")).toHaveAttribute("aria-selected", "true");
  await page.click("#sheet-close");
  await expect(page.locator("#backdrop")).not.toHaveClass(/open/);
});

test("admin can add, rename and delete a course", async ({ page }) => {
  const name = "E2E test course " + Date.now();
  await page.click("#edit-toggle");
  await expect(page.locator("body")).toHaveClass(/editing/);
  await page.locator(".grouphead").first().click();

  await page.locator("[data-add-course]").first().click();
  const title = page.locator('.row.course input[data-field="title"][value="New course"]').last();
  await title.fill(name);
  // Writes are debounced (500 ms) - wait for the save to land, then reload
  // to prove it reached the database.
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/authed/);
  await page.fill("#q", name);
  await expect(page.locator(".row.course")).toHaveCount(1);
  await expect(page.locator(".row.course .name")).toContainText(name);

  await page.click("#edit-toggle");
  await page.locator(".row.course .del").click();
  await answer(page, true, name);
  await expect(page.locator(".row.course")).toHaveCount(0);
  await page.click("#edit-toggle");
});

test("cancelling a delete keeps the course", async ({ page }) => {
  await page.click("#edit-toggle");
  await page.click("#collapse-all");
  const count = await page.locator(".row.course").count();
  await page.locator(".row.course .del").first().click();
  await answer(page, false);
  await expect(page.locator(".row.course")).toHaveCount(count);
});
