// Public tools (docs/ARCHITECTURE.md "Public tools"). "courses": the staff
// course list at /public/courses/#<token>, data from
// /api/public/courses/upcoming with the token in X-Link. The dev seed's link
// (1735000036) has a known token.
const { test, expect } = require("@playwright/test");
const { PB } = require("./helpers");

const DEV_LINK = "DevCoursesLink00000000000000000000000000";
const URL = `${PB}/api/public/courses/upcoming`;

test("courses: the route only answers a valid link, and sends only the card fields", async ({ request }) => {
  expect((await request.get(URL)).status()).toBe(404);
  expect((await request.get(URL, { headers: { "X-Link": "x".repeat(40) } })).status()).toBe(404);
  const res = await request.get(URL, { headers: { "X-Link": DEV_LINK } });
  // 200 with Eventbrite reachable; 502/503 without - never "not valid".
  expect(res.status()).not.toBe(404);
  if (res.ok()) {
    const d = await res.json();
    for (const c of d.courses) expect(Object.keys(c).sort()).toEqual(
      ["end", "image", "name", "online", "price_max", "price_min", "sold_out", "start", "summary", "url", "venue"]);
  }
});

test("courses: the page says so when the link is wrong", async ({ page }) => {
  const res = await page.goto("/public/courses/#" + "y".repeat(40));
  expect(res.status()).toBe(200);
  await expect(page.locator("#out")).toContainText("isn't valid");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
