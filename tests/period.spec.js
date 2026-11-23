// The financial-year selector (js/core/period.js): the whole board shows one
// year, 1 April - 31 March, and its date pickers and steppers stay inside it.
//
// Uses two sessions it makes itself, one each side of the boundary between
// this financial year and the next (31 March / 1 April), on an existing
// course, and removes them again.
const { test, expect } = require("@playwright/test");
const { PB, signIn, pickView, expandAll, apiToken, answer } = require("./helpers");

const now = new Date();
const FY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;   // this year's start
const label = y => y + "/" + String((y + 1) % 100).padStart(2, "0");
const LAST_DAY = `${FY + 1}-03-31`, FIRST_NEXT = `${FY + 1}-04-01`;
const TAG = "E2E FY edge";

let token, made = [];

test.beforeAll(async ({ request }) => {
  token = await apiToken(request);
  const h = { Authorization: token };
  const courses = await (await request.get(`${PB}/api/collections/courses/records?perPage=1&sort=sort`, { headers: h })).json();
  const course = courses.items[0].id;
  for(const date of [LAST_DAY, FIRST_NEXT]){
    const res = await request.post(`${PB}/api/collections/sessions/records`, { headers: h,
      data: { title: `${TAG} ${date}`, room: "Sim Suite 1", date, start: "10:00", end: "12:00", course, sort: 99 } });
    made.push((await res.json()).id);
  }
});

test.afterAll(async ({ request }) => {
  for(const id of made) await request.delete(`${PB}/api/collections/sessions/records/${id}`, { headers: { Authorization: token } });
});

async function pickYear(page, y){
  await page.click("#fy-btn");
  await page.click(`#fy-menu [role=option]:text-is("${label(y)}")`);
  await expect(page.locator("#fy-value")).toHaveText(label(y));
}

test("opens on this financial year and lists next year too", async ({ page }) => {
  await signIn(page);
  await expect(page.locator("#fy-value")).toHaveText(label(FY));
  await page.click("#fy-btn");
  await expect(page.locator(`#fy-menu [role=option]:text-is("${label(FY + 1)}")`)).toHaveCount(1);
  await page.keyboard.press("Escape");
});

test("switching year changes what every view shows", async ({ page }) => {
  await signIn(page);
  const thisYear = await page.locator("#count").textContent();

  await pickYear(page, FY + 1);
  await expect(page.locator("#count")).not.toHaveText(thisYear);
  // Next year: only the 1 April session, not the 31 March one.
  await page.fill("#q", TAG);
  await page.click("#collapse-all");   // expand everything
  await expect(page.locator("#rows .row.session", { hasText: FIRST_NEXT.slice(-2) })).toHaveCount(1);
  await expect(page.locator("#rows")).not.toContainText("31 Mar");

  await pickYear(page, FY);
  await expect(page.locator("#rows")).toContainText("31 Mar");
  await expect(page.locator("#rows")).not.toContainText("1 Apr");
});

test("the week stepper stops at the year's ends, greying the days outside it", async ({ page }) => {
  await signIn(page);
  await pickView(page, "Timetable");
  // Last week of this year: the one holding 31 March.
  for(let i = 0; i < 60 && await page.locator("#next-week").isEnabled(); i++) await page.click("#next-week");
  await expect(page.locator("#next-week")).toBeDisabled();
  await expect(page.locator(`#tt .blk[title*="${TAG} ${LAST_DAY}"]`)).toHaveCount(1);
  await expect(page.locator(`#tt .blk[title*="${TAG} ${FIRST_NEXT}"]`)).toHaveCount(0);
  // 1 April, if it's in that week, is greyed and empty.
  if(new Date(FY + 1, 2, 31).getDay() !== 0)
    await expect(page.locator("#tt .h.out").first()).toBeVisible();

  // Next year starts on that same week, from the other side.
  await pickYear(page, FY + 1);
  await expect(page.locator("#prev-week")).toBeDisabled();
  await expect(page.locator("#this-week")).toBeDisabled();   // today is in this year, not next
  await expect(page.locator(`#tt .blk[title*="${TAG} ${FIRST_NEXT}"]`)).toHaveCount(1);
  await expect(page.locator(`#tt .blk[title*="${TAG} ${LAST_DAY}"]`)).toHaveCount(0);
});

test("session dates can't be set outside the year", async ({ page }) => {
  await signIn(page);
  await page.fill("#q", TAG);
  await page.click("#edit-toggle");
  const date = page.locator(`#rows input[type=date][value="${LAST_DAY}"]`);
  await expect(date).toHaveAttribute("min", `${FY}-04-01`);
  await expect(date).toHaveAttribute("max", LAST_DAY);
  // Typed outside the year: not saved, and put back when the field is left.
  await date.fill(FIRST_NEXT);
  await expect(date).toHaveClass(/\bbad\b/);
  await date.blur();
  await answer(page, true, "outside");
  await expect(date).toHaveValue(LAST_DAY);
  const rec = await (await page.request.get(`${PB}/api/collections/sessions/records/${made[0]}`,
    { headers: { Authorization: token } })).json();
  expect(rec.date).toBe(LAST_DAY);
});

test("a new quote is dated inside the year, and can't be saved outside it", async ({ page }) => {
  await signIn(page);
  await pickYear(page, FY + 1);
  await pickView(page, "Invoices");
  await expandAll(page, "pane-invoices");
  await page.locator("[data-new-inv]").first().click();
  await page.click('#invoicer [data-model="item"]');
  const date = page.locator("#iv-qform input[data-k=date]");
  await expect(date).toHaveValue(FIRST_NEXT);          // today is before next year: its first day
  await expect(date).toHaveAttribute("min", FIRST_NEXT);
  await expect(date).toHaveAttribute("max", `${FY + 2}-03-31`);
  await page.fill("#iv-qform input[data-k=title]", "E2E FY quote");
  await page.fill("#iv-qform input[data-k=client]", "E2E");
  await page.click('#iv-qform [data-add-line="lines"][data-kind="custom"]');
  await page.fill('#iv-qform .iv-line[data-list="lines"] [data-lk="desc"]', "Thing");
  await page.fill('#iv-qform .iv-line[data-list="lines"] [data-lk="price"]', "10");
  await date.fill(LAST_DAY);
  await page.click("#invoicer [data-act=generate-quote]");
  await expect(page.locator("#invoicer .iv-problem")).toContainText(`outside the ${label(FY + 1)} financial year`);
  await expect(page.locator("#iv-refs")).toHaveText("");   // nothing was created
  await page.click("#invoicer [data-act=close]");
  await answer(page, true, "Discard");
});
