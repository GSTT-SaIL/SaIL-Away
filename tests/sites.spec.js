// Sites (docs/MULTISITE-PLAN.md): every site's data is kept to that site,
// tested through the API - the same requests anyone could send, so this is
// what holds whatever the board does. Accounts from the dev seed
// (1735000022): CSSC_EDITOR and CSSC_VIEWER hold only CSSC.
const { test, expect } = require("@playwright/test");
const { ADMIN, VIEWER, PB, apiToken, superuserToken, signIn } = require("./helpers");

const CSSC_EDITOR = { email: "cssc-editor@example.com", password: "cssc-dev-pw1" };
const CSSC_VIEWER = { email: "cssc-viewer@example.com", password: "cssc-dev-pw2" };
const BOTH_EDITOR = { email: "both-editor@example.com", password: "both-dev-pw1" };

// Every collection that belongs to a site.
const PER_SITE = ["groups", "courses", "sessions", "session_notes", "course_notes", "rooms", "departments",
                  "invoice_types", "invoices", "price_list", "form_groups", "form_sets", "forms", "form_responses",
                  "leave", "staff"];

const auth = token => ({ headers: { Authorization: token } });
async function list(request, token, collection, filter = ""){
  const res = await request.get(`${PB}/api/collections/${collection}/records?perPage=500${filter ? "&filter=" + encodeURIComponent(filter) : ""}`, auth(token));
  expect(res.ok(), `${collection}: ${res.status()}`).toBeTruthy();
  return (await res.json()).items;
}
async function sites(request){
  const su = await superuserToken(request);
  const items = await list(request, su, "sites");
  return Object.fromEntries(items.map(s => [s.code, s]));
}

test("each person only sees their own sites' records, in every collection", async ({ request }) => {
  const { sail, cssc } = await sites(request);
  const tokens = {
    admin: await apiToken(request, ADMIN), sailViewer: await apiToken(request, VIEWER),
    csscViewer: await apiToken(request, CSSC_VIEWER), both: await apiToken(request, BOTH_EDITOR),
  };
  for (const c of PER_SITE) {
    const seen = {};
    for (const [who, t] of Object.entries(tokens)) seen[who] = new Set((await list(request, t, c)).map(r => r.site));
    expect([...seen.sailViewer].every(s => s === sail.id), `${c}: SaIL viewer sees only SaIL`).toBeTruthy();
    expect([...seen.csscViewer].every(s => s === cssc.id), `${c}: CSSC viewer sees only CSSC`).toBeTruthy();
    expect([...seen.both].every(s => s === sail.id || s === cssc.id), `${c}: both-site editor sees both`).toBeTruthy();
  }
  // The sample data is in both sites, so these aren't trivially empty.
  expect((await list(request, tokens.csscViewer, "courses")).length).toBeGreaterThan(0);
  expect((await list(request, tokens.sailViewer, "courses")).length).toBeGreaterThan(0);
  // A site list: only your own; admins all.
  expect((await list(request, tokens.csscViewer, "sites")).map(s => s.code)).toEqual(["cssc"]);
  expect((await list(request, tokens.admin, "sites")).map(s => s.code).sort()).toEqual(["cssc", "sail"]);
});

test("a site's Eventbrite token never leaves the server", async ({ request }) => {
  for (const acct of [ADMIN, VIEWER, BOTH_EDITOR]) {
    const t = await apiToken(request, acct);
    for (const s of await list(request, t, "sites")) {
      expect(s.eventbrite_token, `${acct.email} sees ${s.code}'s token`).toBeUndefined();
      expect(s.eventbrite_org).toBeUndefined();
    }
  }
});

test("editors write only to their own sites; viewers never write", async ({ request }) => {
  const { sail, cssc } = await sites(request);
  const ed = await apiToken(request, CSSC_EDITOR);
  const vw = await apiToken(request, CSSC_VIEWER);
  const post = (t, c, data) => request.post(`${PB}/api/collections/${c}/records`, { ...auth(t), data });
  const patch = (t, c, id, data) => request.patch(`${PB}/api/collections/${c}/records/${id}`, { ...auth(t), data });

  // Into your own site: yes. Into another: no.
  const g = await post(ed, "groups", { site: cssc.id, name: "E2E CSSC group", ink: "#000", tint: "#fff" });
  expect(g.status()).toBe(200);
  const group = await g.json();
  expect((await post(ed, "groups", { site: sail.id, name: "E2E sneaky", ink: "#000", tint: "#fff" })).status()).not.toBe(200);
  expect((await post(vw, "groups", { site: cssc.id, name: "E2E viewer", ink: "#000", tint: "#fff" })).status()).not.toBe(200);

  // A child takes its parent's site, whatever the browser says.
  const c = await post(ed, "courses", { site: sail.id, group: group.id, title: "E2E course" });
  expect(c.status()).toBe(200);
  const course = await c.json();
  expect(course.site).toBe(cssc.id);
  // ...and can't be put under another site's parent.
  const sailGroup = (await list(request, await apiToken(request, ADMIN), "groups", `site = "${sail.id}"`))[0];
  expect((await post(ed, "courses", { site: cssc.id, group: sailGroup.id, title: "E2E cross" })).status()).not.toBe(200);
  expect((await patch(ed, "courses", course.id, { group: sailGroup.id })).status()).not.toBe(200);

  // A site never changes.
  expect((await patch(ed, "groups", group.id, { site: sail.id })).status()).not.toBe(200);
  // Another site's records can't be changed or deleted (they're not even found).
  const sailCourse = (await list(request, await apiToken(request, ADMIN), "courses", `site = "${sail.id}"`))[0];
  expect((await patch(ed, "courses", sailCourse.id, { title: "E2E hacked" })).status()).toBe(404);
  expect((await request.delete(`${PB}/api/collections/courses/records/${sailCourse.id}`, auth(ed))).status()).toBe(404);
  // Viewers can't change their own site's records either.
  expect((await patch(vw, "courses", course.id, { title: "E2E viewer edit" })).status()).not.toBe(200);
  // Records with no site at all are refused - even from an admin.
  const admin = await apiToken(request, ADMIN);
  expect((await post(admin, "groups", { name: "E2E no site", ink: "#000", tint: "#fff" })).status()).not.toBe(200);

  // Tidy up (deleting the group takes its course with it).
  expect((await request.delete(`${PB}/api/collections/groups/records/${group.id}`, auth(ed))).status()).toBe(204);
});

test("invoice numbers are per site: SaIL's unchanged, CSSC's prefixed", async ({ request }) => {
  const { sail, cssc } = await sites(request);
  const admin = await apiToken(request, ADMIN);
  const post = (c, data) => request.post(`${PB}/api/collections/${c}/records`, { ...auth(admin), data });
  const made = [];
  try{
    const type = await (await post("invoice_types", { site: cssc.id, name: "E2E CSSC type", calculator: "general", ink: "#000", tint: "#fff" })).json();
    made.push(["invoice_types", type.id]);
    const q = await (await post("invoices", { type: type.id, status: "quoted", title: "E2E CSSC quote" })).json();
    made.unshift(["invoices", q.id]);
    expect(q.site).toBe(cssc.id);
    expect(q.quote_ref).toMatch(/^CSSC-Q-\d{4}-\d{4}$/);

    const sailType = (await list(request, admin, "invoice_types", `site = "${sail.id}"`))[0];
    const s = await (await post("invoices", { type: sailType.id, status: "quoted", title: "E2E SaIL quote" })).json();
    made.unshift(["invoices", s.id]);
    expect(s.quote_ref).toMatch(/^Q-\d{4}-\d{4}$/);
  }finally{
    for (const [c, id] of made) await request.delete(`${PB}/api/collections/${c}/records/${id}`, auth(admin));
  }
});

test("the public availability page shows the site's own banner", async ({ page }) => {
  await page.goto("/availability.html?site=cssc");
  await expect(page.locator("#brand-mark .nm")).toHaveText("CSSC");
  await expect(page.locator("#brand-logo")).toBeHidden();
  await page.goto("/availability.html");
  await expect(page.locator("#brand-logo")).toBeVisible();
  await expect(page.locator("#brand-mark")).toBeHidden();
});

test("public availability is per site", async ({ request }) => {
  const sail = await (await request.get(`${PB}/api/availability`)).json();
  const cssc = await (await request.get(`${PB}/api/availability?site=cssc`)).json();
  expect(sail.rooms).toContain("Sim Suite 1");
  expect(sail.rooms).not.toContain("CSSC Sim Lab");
  expect(cssc.rooms).toEqual(["CSSC Skills Room", "CSSC Sim Lab"]);
  expect(cssc.busy.every(b => cssc.rooms.includes(b.room))).toBeTruthy();
  expect((await request.get(`${PB}/api/availability?site=nope`)).status()).toBe(404);
});

test("Eventbrite is per site: only for a site you hold", async ({ request }) => {
  const { sail } = await sites(request);
  const cssc = await apiToken(request, CSSC_VIEWER);
  const res = await request.get(`${PB}/api/eventbrite/events?site=${sail.id}`, auth(cssc));
  expect(res.status()).toBe(404);
});

// ---- the board ----
const pickSite = async (page, name) => {
  await page.click("#site-btn");
  await page.click(`#site-menu [role=option]:has-text("${name}")`);
  await expect(page.locator("#site-value")).toHaveText(name);
};
const views = async page => {
  await page.click("#view-btn");
  const names = (await page.locator("#view-menu [role=option]").allInnerTexts()).map(t => t.trim());
  await page.keyboard.press("Escape");
  return names;
};

test("the site selector: only for more than one site; switching shows that site's data", async ({ page }) => {
  await signIn(page, ADMIN);
  await expect(page.locator("#site-wrap")).toBeVisible();
  await expect(page.locator("#rows")).toContainText("Internal Support");     // SaIL's
  await expect(page.locator("#rows")).not.toContainText("CSSC Courses");
  expect(await views(page)).toContain("Tickets");

  await expect(page.locator("#brand-logo")).toBeVisible();                   // SaIL: its logo
  await expect(page.locator("#brand-mark")).toBeHidden();

  await pickSite(page, "CSSC");
  await expect(page.locator("#brand-logo")).toBeHidden();                    // CSSC: its wordmark
  await expect(page.locator("#brand-mark .nm")).toHaveText("CSSC");
  await expect(page.locator("#rows")).toContainText("CSSC Courses");
  await expect(page.locator("#rows")).not.toContainText("Internal Support");
  await expect(page.locator("#count")).toHaveText("1 courses, 1 sessions");
  expect(await views(page)).not.toContain("Tickets");                       // CSSC has no Tickets

  await pickSite(page, "SaIL");
  await expect(page.locator("#rows")).toContainText("Internal Support");
});

test("the site on show is remembered for the person, not the browser", async ({ page }) => {
  const saved = () => page.waitForResponse(r => r.url().includes("/user_prefs/records") && r.request().method() !== "GET");
  await signIn(page, ADMIN);
  let save = saved();
  await pickSite(page, "CSSC");
  await save;
  await page.click("#logout-btn");
  await signIn(page, ADMIN, { keepPlace: true });
  await expect(page.locator("#site-value")).toHaveText("CSSC");
  await expect(page.locator("#rows")).toContainText("CSSC Courses");
  // Put it back for the other tests.
  save = saved();
  await pickSite(page, "SaIL");
  await save;
});

test("one site: no selector; the Edit button follows the role", async ({ page }) => {
  await signIn(page, CSSC_EDITOR);
  await expect(page.locator("#site-wrap")).toBeHidden();
  await expect(page.locator("#rows")).toContainText("CSSC Courses");
  await expect(page.locator("#edit-toggle")).toBeVisible();

  await page.click("#logout-btn");
  await signIn(page, CSSC_VIEWER);
  await expect(page.locator("#site-wrap")).toBeHidden();
  await expect(page.locator("#rows")).toContainText("CSSC Courses");
  await expect(page.locator("#edit-toggle")).toBeHidden();

  await page.click("#logout-btn");
  await signIn(page, VIEWER);
  await expect(page.locator("#site-wrap")).toBeHidden();
  await expect(page.locator("#rows")).toContainText("Internal Support");
  await expect(page.locator("#rows")).not.toContainText("CSSC Courses");
});

test("an editor of two sites can edit on both", async ({ page }) => {
  await signIn(page, BOTH_EDITOR);
  await expect(page.locator("#site-wrap")).toBeVisible();
  await expect(page.locator("#edit-toggle")).toBeVisible();
  await pickSite(page, "CSSC");
  await expect(page.locator("#edit-toggle")).toBeVisible();
});

// ---- "All": every site at once, admins only, view-only ----
test("All: admins only, Courses and Timetable, nothing editable", async ({ page }) => {
  await signIn(page, BOTH_EDITOR);                       // two sites, but not an admin
  await page.click("#site-btn");
  await expect(page.locator('#site-menu [role=option]:has-text("All")')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.click("#logout-btn");

  await signIn(page, ADMIN);
  // Something opened on a site doesn't stay open in All (same records).
  await page.locator('#rows .grouphead:has-text("Internal Support")').click();
  await expect(page.locator('#rows .grouphead[aria-expanded="true"]')).toHaveCount(1);
  await pickSite(page, "All");
  await expect(page.locator("#rows .grouphead").first()).toBeVisible();
  await expect(page.locator('#rows .grouphead[aria-expanded="true"]')).toHaveCount(0);
  expect(await views(page)).toEqual(["Courses", "Timetable", "Rota", "Staff"]);
  await expect(page.locator("#edit-toggle")).toBeHidden();
  await expect(page.locator("#brand-mark .nm")).toHaveText("All");

  // Courses: every site's groups, each with its site's label.
  await expect(page.locator("#rows .grouphead .sitetag", { hasText: "SaIL" }).first()).toBeVisible();
  await expect(page.locator("#rows .grouphead .sitetag", { hasText: "CSSC" }).first()).toBeVisible();
  await expect(page.locator("#rows")).toContainText("Internal Support");
  await expect(page.locator("#rows")).toContainText("CSSC Courses");

  // Timetable: rooms labelled by site; bookings plain grey.
  await page.click("#view-btn");
  await page.click('#view-menu [role=option]:has-text("Timetable")');
  await expect(page.locator("#tt .room .sitetag", { hasText: "CSSC" }).first()).toBeVisible();
  await expect(page.locator("#tt .room .sitetag", { hasText: "SaIL" }).first()).toBeVisible();
  await expect(page.locator("#tt-key")).toBeHidden();                       // no key bar in All
  expect(await page.locator("#tt .blk:not(.neutral)").count()).toBe(0);
  expect(await page.locator("#tt .blk.neutral").count()).toBeGreaterThan(0);

  // Staff: every site's people, each labelled with their site; view-only.
  await page.click("#view-btn");
  await page.click('#view-menu [role=option]:has-text("Staff")');
  await expect(page.locator("#pane-staff .grouphead .sitetag", { hasText: "SaIL" }).first()).toBeVisible();
  await expect(page.locator("#pane-staff .grouphead .sitetag", { hasText: "CSSC" }).first()).toBeVisible();
  await expect(page.locator("#pane-staff")).toContainText("Casey Lane");
  await expect(page.locator("#pane-staff")).toContainText("Alex Morgan");
  await expect(page.locator("#edit-toggle")).toBeHidden();

  // Back to one site: its own colours and the Edit button return.
  await pickSite(page, "SaIL");
  await expect(page.locator("#edit-toggle")).toBeVisible();
  await page.click("#view-btn");
  await page.click('#view-menu [role=option]:has-text("Timetable")');
  await expect(page.locator("#tt-key")).toBeVisible();                      // a site's own Timetable keeps it
});

// ---- each person's own view settings (core/prefs.js) ----
test("view settings: everyone reads and writes only their own", async ({ request }) => {
  const login = async a => (await (await request.post(`${PB}/api/collections/users/auth-with-password`,
    { data: { identity: a.email, password: a.password } })).json());
  const admin = await login(ADMIN), viewer = await login(VIEWER);
  const url = `${PB}/api/collections/user_prefs/records`;

  // A viewer may keep their own (unlike board data)...
  let mine = (await list(request, viewer.token, "user_prefs"))[0];
  if (!mine) {
    const res = await request.post(url, { ...auth(viewer.token), data: { user: viewer.record.id, data: {} } });
    expect(res.ok(), "viewer creates own").toBeTruthy();
    mine = await res.json();
  }
  // ...but not make one for someone else, or hand theirs over.
  expect((await request.post(url, { ...auth(viewer.token), data: { user: admin.record.id, data: { x: 1 } } })).ok()).toBeFalsy();
  expect((await request.patch(`${url}/${mine.id}`, { ...auth(viewer.token), data: { user: admin.record.id } })).ok()).toBeFalsy();
  // Nobody sees anyone else's.
  for (const who of [admin, viewer])
    for (const row of await list(request, who.token, "user_prefs")) expect(row.user).toBe(who.record.id);
  expect((await request.get(`${url}/${mine.id}`, auth(admin.token))).status()).toBe(404);
});
