// "Create event" on Tickets (js/views/eventbrite/create.js,
// pb_hooks/eventbrite_create.pb.js). These only ever use the DRY RUN: every
// Eventbrite call is built and reported, nothing is sent (the user's rule -
// real drafts are tested by hand).
const { test, expect } = require("@playwright/test");
const { ADMIN, VIEWER, PB, signIn, pickView, apiToken } = require("./helpers");

const auth = t => ({ headers: { Authorization: t } });
const sailId = async (request, t) =>
  (await (await request.get(`${PB}/api/collections/sites/records?filter=${encodeURIComponent('code = "sail"')}`, auth(t))).json()).items[0].id;
const BODY = { dry: true, loc: "venue", title: "E2E dry run", summary: "", about: "Line",
  tickets: [{ id: "ext", on: true, price: 150, places: 10 }, { id: "int", on: true, places: 4 }, { id: "made-up", on: true, places: 1 }, { id: "fac", on: true, places: 4 }, { id: "part", on: true, places: 2 }],
  dates: [{ venue: "33722319", daily: "", start_utc: "2027-03-10T09:30:00Z", end_utc: "2027-03-10T16:30:00Z", sales_end_utc: "2027-03-09T09:30:00Z" }],
  image: { key: "bg1", name: "Background 1" } };

test("the server builds the drafts in a dry run, for admins and editors only", async ({ request }) => {
  const admin = await apiToken(request, ADMIN), viewer = await apiToken(request, VIEWER);
  const site = await sailId(request, admin);
  const url = `${PB}/api/eventbrite/create?site=${site}`;
  const res = await request.post(url, { ...auth(admin), data: BODY });
  expect(res.ok()).toBeTruthy();
  const out = await res.json();
  expect(out.dry).toBe(true);
  const steps = out.courses[0].steps.map(s => s.step);
  expect(steps).toContain("Create draft event");
  expect(steps).toContain("Ticket: Non-GSTT (External)");
  expect(steps).toContain("Staff access code");                         // one fixed code for every staff ticket
  expect(out.courses[0].steps.find(s => s.step === "Staff access code").detail)
    .toMatch(/^[A-HJ-NP-Z2-9]{12} reveals GSTT Staff$/);                // the site's random code, not a guessable word
  expect(steps.join()).not.toContain("made-up");                       // only the standard tickets
  expect(steps.join()).not.toMatch(/Faculty|Partner|registration/);     // removed 2026-10-30
  expect(steps).toContain("Standard question: Organisation");           // asked of externals only
  expect(out.courses[0].steps.find(s => s.step === "Standard question: Organisation").detail).toBe("Asked for Non-GSTT (External)");
  expect(out.courses[0].steps.find(s => s.step === "Ticket: GSTT Staff").detail).toContain("max 1 per order");
  expect(out.courses[0].event_id).toBe("");                             // nothing created
  // Someone else's venue, and a viewer: refused.
  expect((await request.post(url, { ...auth(admin), data: { ...BODY, dates: [{ ...BODY.dates[0], venue: "1" }] } })).status()).toBe(400);
  expect((await request.post(url, { ...auth(viewer), data: BODY })).status()).toBe(403);
  // Deleting only touches drafts the board made.
  const del = await (await request.post(`${PB}/api/eventbrite/delete?site=${site}`, { ...auth(admin), data: { ids: ["123"] } })).json();
  expect(del.deleted[0].ok).toBe(false);
});

test("Create event opens the course form; the dry run reports without creating", async ({ page }) => {
  await signIn(page);
  await pickView(page, "Tickets");
  await page.click("#tk-create");
  await expect(page.locator("#backdrop .ebf")).toBeVisible();
  // Nothing outlined on opening; a try with gaps outlines only what blocks it
  // (title, image) - and sends nothing.
  await expect(page.locator("#backdrop .ebf .bad")).toHaveCount(0);
  // Create is off while anything is waiting; clicking it shows what blocks it.
  await expect(page.locator("#eb-send")).toBeDisabled();
  await page.click("#eb-sendwrap");
  await expect(page.locator("#eb-status")).toContainText("Fix the");
  await expect(page.locator("#eb-title")).toHaveClass(/\bbad\b/);
  await expect(page.locator("#eb-summary")).not.toHaveClass(/\bbad\b/);          // a warning, not a block
  await page.fill("#eb-title", "E2E dry run");
  await page.locator("#eb-imgs label").first().click();
  await expect(page.locator("#backdrop .ebf .bad")).toHaveCount(0);
  // Only the no-summary warning is left: still off until it's ticked as checked.
  await expect(page.locator("#eb-send")).toBeDisabled();
  await expect(page.locator("#eb-ackrow")).toBeVisible();
  await page.check("#eb-ack");
  await expect(page.locator("#eb-send")).toBeEnabled();
  // A new warning clears the tick: a summary removes one, so the set changes.
  await page.fill("#eb-summary", "A summary");
  await expect(page.locator("#eb-ackrow")).toBeHidden();                         // no warnings left
  await expect(page.locator("#eb-send")).toBeEnabled();
  await page.click("#eb-dry");
  await expect(page.locator("#eb-status")).toContainText("Nothing was sent");
  await expect(page.locator("#eb-results .rs.plan").first()).toBeVisible();
  await expect(page.locator("#eb-del")).toHaveCount(0);
});
