// Forms: the board's Forms page (categories -> form sets -> forms), the
// form pop-up's Preview / Questions / Responses tabs, the public form page
// (/f/<code>), and the server's protections (pb_hooks/forms.pb.js).
// Everything a test makes is in a category named "E2E ..." and removed
// afterwards (deleting a category removes its sets, forms and responses).
const { test, expect } = require("@playwright/test");
const { ADMIN, VIEWER, PB, signIn, pickView, expandAll, apiToken, answer, siteIdOf } = require("./helpers");

test.afterAll(async ({ request }) => {
  const token = await apiToken(request);
  const res = await request.get(`${PB}/api/collections/form_groups/records?perPage=200&filter=${encodeURIComponent('name ~ "E2E"')}`,
    { headers: { Authorization: token } });
  for(const g of (await res.json()).items || [])
    await request.delete(`${PB}/api/collections/form_groups/records/${g.id}`, { headers: { Authorization: token } });
});

// A form made through the API, for the tests that aren't about building one.
async function makeForm(request, { open = true, questions } = {}){
  const token = await apiToken(request), h = { headers: { Authorization: token } };
  const post = async (c, data) => (await request.post(`${PB}/api/collections/${c}/records`, { ...h, data })).json();
  const g = await post("form_groups", { site: await siteIdOf(request, token), name: "E2E api " + Date.now(), ink: "#0060c0", tint: "#e8f1fd", sort: 99 });
  const s = await post("form_sets", { group: g.id, title: "E2E set", sort: 0 });
  const f = await post("forms", { set: s.id, title: "E2E form", sort: 0, open, closes: "",
    settings: { intro: "Hello", submitLabel: "Send", thanks: "Thanks, E2E.", anonymous: true },
    questions: questions || [
      { id: "qa", type: "text", label: "Your code", required: true },
      { id: "qb", type: "choice", label: "Role", required: true, options: ["Doctor", "Other"], display: "list" },
      { id: "qc", type: "text", label: "Which role?", required: true, showIf: { q: "qb", value: "Other" } },
      { id: "qd", type: "yesno", label: "I agree", required: true },
    ] });
  return { token, group: g, set: s, form: f };
}

test("viewers see forms and responses but can't change them", async ({ page, request }) => {
  await makeForm(request);
  await signIn(page, VIEWER);
  await pickView(page, "Forms");
  await expect(page.locator("#edit-toggle")).toBeHidden();
  await expandAll(page, "pane-forms");
  await page.locator("#form-rows [data-fopen]", { hasText: "E2E form" }).first().click();
  await expect(page.locator("#sheet-panel-preview iframe")).toBeVisible();
  await expect(page.locator('#sheet-panel-preview [data-fp="toggle"]')).toHaveCount(0);   // no Open/Close
  await page.click("#sheet-tab-questions");
  await expect(page.locator("#sheet-panel-questions .fed.readonly")).toBeVisible();
  await expect(page.locator('#sheet-panel-questions [data-e="save"]')).toHaveCount(0);
  await expect(page.locator("#sheet-panel-questions [data-qk=label]").first()).toBeDisabled();
  await page.click("#sheet-tab-responses");
  await expect(page.locator("#sheet-panel-responses [data-fr-del]")).toHaveCount(0);
});

test("admins build a form, publish it, and see its responses", async ({ page, request }) => {
  await signIn(page, ADMIN);
  await pickView(page, "Forms");
  await page.click("#edit-toggle");
  const cat = "E2E built " + Date.now();
  await page.click("[data-fadd-group]");
  await page.locator('#form-rows input[data-gk="name"]').last().fill(cat);
  await page.locator("[data-fadd-set]").last().click();
  await page.locator('#form-rows input[data-sk="title"]').last().fill("E2E course");
  await page.locator("[data-fadd-form]").last().click();
  // A new form opens straight on its Questions tab.
  await expect(page.locator("#sheet-tab-questions")).toHaveClass(/\bon\b/);
  const P = page.locator("#sheet-panel-questions");
  await P.locator('[data-e="title"]').fill("E2E feedback");
  await P.locator('[data-e="open"]').check();
  await P.locator('[data-e="newtype"]').selectOption("choice");
  await P.locator('[data-e="add"]').click();
  await P.locator('.fq[data-i="0"] [data-qk="label"]').fill("Was it useful?");
  await P.locator('.fq[data-i="0"] [data-qk="options"]').fill("Yes\nNo");
  await P.locator('.fq[data-i="0"] [data-qk="required"]').check();
  await P.locator('[data-e="newtype"]').selectOption("long");
  await P.locator('[data-e="add"]').click();
  await P.locator('.fq[data-i="1"] [data-qk="label"]').fill("Why not?");
  await P.locator('.fq[data-i="1"] [data-qk="showIfQ"]').selectOption({ index: 1 });
  await P.locator('.fq[data-i="1"] [data-qk="showIfV"]').selectOption("No");
  await P.locator('[data-e="save"]').click();
  await expect(P.locator(".festatus")).toHaveText("");
  // Preview: the saved form, in a frame, unable to submit.
  await page.click("#sheet-tab-preview");
  const frame = page.frameLocator("#sheet-panel-preview iframe");
  await expect(frame.locator("h1")).toHaveText("E2E feedback");
  await expect(frame.locator("#fsend")).toBeDisabled();
  const link = await page.locator("#sheet-panel-preview .flink").inputValue();
  // QR code for the link, downloadable as a PNG.
  await page.click('#sheet-panel-preview [data-fp="qr"]');
  await expect(page.locator("#sheet-panel-preview .fqrimg svg")).toBeVisible();
  const [png] = await Promise.all([page.waitForEvent("download"), page.click('#sheet-panel-preview [data-fp="qrpng"]')]);
  expect(png.suggestedFilename()).toBe("E2E feedback - QR code.png");
  const bytes = await require("fs").promises.readFile(await png.path());
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  await page.click("#sheet-close");
  await page.click("#edit-toggle");

  // The public page: "Why not?" appears only after "No"; then it's sent.
  const pub = await page.context().newPage();
  await pub.goto(new URL(link).pathname);
  await expect(pub.locator("h1")).toHaveText("E2E feedback");
  await expect(pub.locator('[data-qwrap] >> text=Why not?')).toBeHidden();
  await pub.click("#fsend");
  await expect(pub.locator("#fproblem")).toContainText("Was it useful?");
  await pub.selectOption("select[data-q]", "No");    // a new choice question is a dropdown
  await expect(pub.locator('[data-qwrap] >> text=Why not?')).toBeVisible();
  await pub.locator("textarea[data-q]").fill("E2E reason");
  await pub.waitForTimeout(2100);                     // the server ignores sends under 2 seconds
  await pub.click("#fsend");
  await expect(pub.locator(".fdone")).toBeVisible();
  await pub.close();

  // Its response, in the board, and as CSV. (Its set is still open.)
  await page.locator("#form-rows [data-fopen]", { hasText: "E2E feedback" }).click();
  await page.click("#sheet-tab-responses");
  const R = page.locator("#sheet-panel-responses");
  await expect(R.locator(".frcount")).toContainText("1 response");
  await expect(R.locator("tbody tr").first()).toContainText("E2E reason");
  const [csv] = await Promise.all([page.waitForEvent("download"), R.locator('[data-fr="csv"]').click()]);
  const text = await require("fs").promises.readFile(await csv.path(), "utf8");
  expect(text).toContain('"Was it useful?","Why not?"');
  expect(text).toContain('"No","E2E reason"');
  // Deleting a response asks first.
  await R.locator("[data-fr-del]").first().click();
  await answer(page, true, "Delete this response");
  await expect(R.locator(".frcount")).toContainText("0 responses");
});

test("closing with unsaved question changes asks first", async ({ page, request }) => {
  await makeForm(request);
  await signIn(page, ADMIN);
  await pickView(page, "Forms");
  await expandAll(page, "pane-forms");
  await page.locator("#form-rows [data-fopen]", { hasText: "E2E form" }).first().click();
  await page.click("#sheet-tab-questions");
  await page.locator('#sheet-panel-questions [data-e="title"]').fill("E2E changed");
  await page.keyboard.press("Escape");
  await answer(page, false, "Discard your unsaved changes");
  await expect(page.locator("#backdrop")).toHaveClass(/\bopen\b/);
  await page.click("#sheet-close");
  await answer(page, true);
  await expect(page.locator("#backdrop")).not.toHaveClass(/\bopen\b/);
});

test("duplicating and deleting forms in edit mode", async ({ page, request }) => {
  const { group } = await makeForm(request);
  await signIn(page, ADMIN);
  await pickView(page, "Forms");
  await expandAll(page, "pane-forms");
  await page.click("#edit-toggle");
  const sec = page.locator("#form-rows .gsec", { has: page.locator(`input[value="${group.name}"]`) });
  await sec.locator("[data-fdup]").first().click();
  await expect(sec.locator('input[data-fk="title"]')).toHaveCount(2);
  await expect(sec.locator('input[data-fk="title"]').nth(1)).toHaveValue("E2E form (copy)");
  await sec.locator('[data-del^="form:"]').nth(1).click();
  await answer(page, true, "Delete the form");
  await expect(sec.locator('input[data-fk="title"]')).toHaveCount(1);
  await page.click("#edit-toggle");
});

test("the public page: closed forms, unknown links, and the preview can't submit", async ({ page, request }) => {
  const { form } = await makeForm(request, { open: false });
  await page.goto(`/f/${form.code}`);
  await expect(page.locator(".fstatus")).toContainText("closed");
  await page.goto(`/f/${form.code}?preview=1`);
  await expect(page.locator(".fpreview")).toContainText("Preview");
  await expect(page.locator("#fsend")).toBeDisabled();
  await page.goto("/f/notarealformcode000000");
  await expect(page.locator("h1")).toHaveText("Form not found");
});

test("server rules: public reads and checked submissions only", async ({ request }) => {
  const { token, form } = await makeForm(request);
  const h = { headers: { Authorization: token } };
  const url = `${PB}/api/forms/public/${form.code}`;
  // Each case from its own address (the route is rate-limited per address).
  const send = (body, ip) => request.post(url, { data: { website: "", t: 5000, ...body }, headers: { "X-Forwarded-For": ip } });
  const count = async () => (await (await request.get(`${PB}/api/collections/form_responses/records?filter=${encodeURIComponent(`form = "${form.id}"`)}`, h)).json()).totalItems;

  expect(form.code).toMatch(/^[a-z0-9]{20}$/);                              // set by the server
  const pub = await (await request.get(url)).json();
  expect(Object.keys(pub).sort()).toEqual(["anonymous", "intro", "open", "questions", "submitLabel", "thanks", "title"]);
  expect((await request.get(`${PB}/api/collections/forms/records`)).ok()).toBeTruthy();
  expect((await (await request.get(`${PB}/api/collections/forms/records`)).json()).totalItems).toBe(0);   // anonymous: nothing
  expect((await request.post(`${PB}/api/collections/form_responses/records`, { ...h, data: { form: form.id, answers: {} } })).status()).toBe(403);
  expect((await request.patch(`${PB}/api/collections/forms/records/${form.id}`, { ...h, data: { code: "x".repeat(20) } })).status()).toBe(400);

  const good = { qa: "E2E", qb: "Doctor", qd: true };
  expect((await send({ answers: { ...good, qa: "" } }, "198.51.100.21")).status()).toBe(400);           // required
  expect((await send({ answers: { ...good, qb: "Wizard" } }, "198.51.100.22")).status()).toBe(400);     // not an option
  expect((await send({ answers: { ...good, qb: "Other" } }, "198.51.100.23")).status()).toBe(400);      // shown, so required
  expect((await send({ answers: { ...good, qd: false } }, "198.51.100.24")).status()).toBe(400);        // must tick
  expect((await send({ answers: good, website: "spam" }, "198.51.100.25")).status()).toBe(200);        // honeypot: "ok"...
  expect((await send({ answers: good, t: 300 }, "198.51.100.26")).status()).toBe(200);                 // too fast: "ok"...
  expect(await count()).toBe(0);                                                                         // ...but not saved
  expect((await send({ answers: { ...good, qx: "extra" } }, "198.51.100.27")).status()).toBe(200);
  const saved = await (await request.get(`${PB}/api/collections/form_responses/records?filter=${encodeURIComponent(`form = "${form.id}"`)}`, h)).json();
  expect(saved.items[0].answers).toEqual({ qa: "E2E", qb: "Doctor", qd: true });                       // unknown answers dropped
  expect(saved.items[0].labels).toEqual({ qa: "Your code", qb: "Role", qd: "I agree" });
  // Rate limit: 5 a minute per address (a fresh one each run - the limit
  // outlasts a quick re-run).
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  const codes = [];
  for(let i = 0; i < 6; i++) codes.push((await send({ answers: good }, ip)).status());
  expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
});
