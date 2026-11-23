// Apps (pb_migrations/1735000032_apps.js): link cards, each limited to some
// sites and some kinds of account - enforced by the server. Sample apps
// from the dev seed (1735000033): ESR (everyone, SaIL + CSSC), Eventbrite
// organiser (SaIL editors/admins), Finance portal (admins only); and
// "Upcoming courses" (SaIL, everyone - 1735000036).
const { test, expect } = require("@playwright/test");
const { ADMIN, VIEWER, PB, signIn, pickView, apiToken } = require("./helpers");

const CSSC_VIEWER = { email: "cssc-viewer@example.com", password: "cssc-dev-pw2" };
const titles = async (request, account) => {
  const t = await apiToken(request, account);
  const res = await request.get(`${PB}/api/collections/apps/records?perPage=50`, { headers: { Authorization: t } });
  return (await res.json()).items.map(a => a.title).sort();
};

test("the server only sends apps for your role and your sites", async ({ request }) => {
  expect(await titles(request, ADMIN)).toEqual(["ESR", "Eventbrite organiser", "Finance portal", "Upcoming courses"]);
  expect(await titles(request, VIEWER)).toEqual(["ESR", "Upcoming courses"]);
  expect(await titles(request, CSSC_VIEWER)).toEqual(["ESR"]);
  const anon = await (await request.get(`${PB}/api/collections/apps/records`)).json();
  expect(anon.totalItems).toBe(0);
});

test("Apps page: cards for the site on show, filterable, opening in a new tab", async ({ page }) => {
  await signIn(page);
  await pickView(page, "Apps");
  const cards = page.locator("#pane-apps .appcard");
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toHaveAttribute("target", "_blank");
  await expect(cards.first()).toHaveAttribute("rel", /noopener/);
  await page.fill("#q", "finance");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Finance portal");
  await page.fill("#q", "");

  await page.click("#logout-btn");
  await signIn(page, VIEWER);
  await pickView(page, "Apps");
  await expect(page.locator("#pane-apps .appcard")).toHaveCount(2);
  await expect(page.locator("#pane-apps")).not.toContainText("Finance portal");
});
