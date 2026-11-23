// Things reachable without signing in: what must stay private, and the one
// public page.
const { test, expect } = require("@playwright/test");

const PB = process.env.PB_URL || "http://localhost:8090";

test("web server does not serve private repo files", async ({ request }) => {
  for (const path of ["/.env", "/.env.example", "/.git/config", "/docker-compose.yml",
                      "/pocketbase/pb_hooks/eventbrite.pb.js", "/CLAUDE.md", "/nginx/site.conf"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
  }
});

test("collections return nothing to anonymous requests", async ({ request }) => {
  for (const name of ["groups", "courses", "sessions", "session_notes", "course_notes", "rooms", "departments",
                      "invoice_types", "invoices", "price_list", "user_prefs", "leave", "staff", "apps"]) {
    const res = await request.get(`${PB}/api/collections/${name}/records`);
    // PocketBase applies a list rule as a filter: an anonymous list is a 200
    // with no items, not an error. 404 = collection doesn't exist (yet).
    if (res.status() === 404) continue;
    expect(res.ok(), name).toBeTruthy();
    const body = await res.json();
    expect(body.items, name).toEqual([]);
    expect(body.totalItems, name).toBe(0);
  }
});

test("public availability endpoint exposes room/date/start/end only", async ({ request }) => {
  const res = await request.get(`${PB}/api/availability`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(["busy", "rooms", "site"]);
  // How the site shows itself in the banner - and nothing else about it
  // (no id, code, number prefix, views or Eventbrite fields).
  expect(Object.keys(body.site).sort()).toEqual(["colour", "full_name", "logo", "name"]);
  expect(body.rooms.length).toBeGreaterThan(0);
  for (const r of body.rooms) expect(typeof r).toBe("string");
  for (const b of body.busy) expect(Object.keys(b).sort()).toEqual(["date", "end", "room", "start"]);
});

test("public availability page renders without signing in", async ({ page }) => {
  await page.goto("/availability.html");
  await expect(page.locator("#av .room").first()).toBeVisible();
  // No course detail anywhere on the page.
  await expect(page.locator("#av .blk:not(.av)")).toHaveCount(0);
});
