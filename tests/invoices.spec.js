// Invoices view: who can see it, the full quote -> invoice -> paid flow with
// PDFs, editing a generated quote in place, no drafts, the server-side
// rules, and price snapshots.
// Every record a test creates is titled "E2E ..." and removed afterwards.
const { test, expect } = require("@playwright/test");
const { ADMIN, VIEWER, PB, signIn, pickView, expandAll, apiToken, superuserToken, answer, siteIdOf } = require("./helpers");

const created = [];
test.afterAll(async ({ request }) => {
  const su = await superuserToken(request);
  if(!su) return;
  const res = await request.get(`${PB}/api/collections/invoices/records?perPage=500&filter=${encodeURIComponent('title ~ "E2E"')}`,
    { headers: { Authorization: su } });
  for(const r of (await res.json()).items || [])
    await request.delete(`${PB}/api/collections/invoices/records/${r.id}`, { headers: { Authorization: su } });
});

async function typeNamed(request, token, name){
  const res = await request.get(`${PB}/api/collections/invoice_types/records?filter=${encodeURIComponent(`name = "${name}"`)}`,
    { headers: { Authorization: token } });
  return (await res.json()).items[0];
}
const eventType = (request, token) => typeNamed(request, token, "Events");
// SaIL's price list (every site has its own).
async function priceList(request, token){
  const sail = await siteIdOf(request, token);
  const res = await request.get(`${PB}/api/collections/price_list/records?filter=${encodeURIComponent(`site = "${sail}"`)}`, { headers: { Authorization: token } });
  return (await res.json()).items[0];
}

test("viewers can see invoices but not change them, in the board or the API", async ({ page, request }) => {
  await signIn(page, VIEWER);
  await pickView(page, "Invoices");
  await expandAll(page, "pane-invoices");
  await expect(page.locator("#pane-invoices .irow[data-open-inv]").first()).toBeVisible();
  await expect(page.locator("#pane-invoices [data-new-inv]")).toHaveCount(0);   // no "New quote"
  await expect(page.locator("#edit-toggle")).toBeHidden();

  // The pop-up shows everything, offers nothing to change.
  // Click the title: the progress steps in the middle of a row download PDFs.
  await page.locator("#pane-invoices .irow[data-open-inv] .ttl").first().click();
  await expect(page.locator("#invoicer")).toBeVisible();
  await expect(page.locator("#iv-flow input, #iv-flow .iv-go, #iv-flow .iv-back, #iv-flow [data-model]")).toHaveCount(0);
  await expect(page.locator('#invoicer [data-act="delete"]')).toHaveCount(0);
  await page.click('#invoicer [data-act="close"]');

  // API: can read, can't write. (The viewer holds SaIL; the admin every
  // site - so compare with SaIL's.)
  const vt = await apiToken(request, VIEWER), at = await apiToken(request, ADMIN);
  const sail = encodeURIComponent(`site = "${await siteIdOf(request, at)}"`);
  for(const name of ["invoices", "invoice_types", "price_list"]){
    const v = await (await request.get(`${PB}/api/collections/${name}/records`, { headers: { Authorization: vt } })).json();
    const a = await (await request.get(`${PB}/api/collections/${name}/records?filter=${sail}`, { headers: { Authorization: at } })).json();
    expect(v.totalItems, name).toBe(a.totalItems);
  }
  const type = await eventType(request, at);
  const create = await request.post(`${PB}/api/collections/invoices/records`,
    { headers: { Authorization: vt }, data: { type: type.id, status: "quoted", title: "E2E viewer" } });
  expect(create.ok()).toBeFalsy();
  const prices = await priceList(request, at);
  const edit = await request.patch(`${PB}/api/collections/price_list/records/${prices.id}`,
    { headers: { Authorization: vt }, data: { vat: 99 } });
  expect(edit.ok()).toBeFalsy();
});

// The pop-up's details pane is a flow (steps 1 Quote, 2 Invoice, 3 Paid) -
// only the due step's form and actions are open.
const fstep = (page, n) => page.locator(`#iv-flow [data-fstep="${n}"]`);
const act = (page, a) => page.click(`#invoicer [data-act="${a}"]`);
const expectStage = async (page, ticked) => {
  for(const n of [1, 2, 3]){
    const f = expect(fstep(page, n), `flow step ${n}`);
    await f.toHaveClass(n <= ticked ? /\bdone\b/ : n === ticked + 1 ? /\bactive\b/ : /\blocked\b/);
  }
};

test("event quote to paid invoice, step by step, with PDFs", async ({ page, request }) => {
  await signIn(page, ADMIN);
  await pickView(page, "Invoices");
  await expandAll(page, "pane-invoices");
  const title = "E2E event " + Date.now();

  // Admins get a "New quote" row in each group, no edit mode needed; it opens on step 1.
  const eventsId = (await eventType(request, await apiToken(request))).id;
  await page.locator(`#pane-invoices [data-new-inv="${eventsId}"]`).click();
  await expectStage(page, 0);
  await expect(page.locator("#iv-iform")).toHaveCount(0);           // invoice details not open yet
  // First question: what kind of quote - whichever group it's in.
  await expect(page.locator("#iv-flow [data-model]")).toHaveCount(2);
  await page.click('#iv-flow [data-model="attendee"]');
  const q = page.locator("#iv-qform");
  await q.locator('[data-k="title"]').fill(title);
  await q.locator('[data-k="client"]').fill("E2E Client Ltd");
  await q.locator('[data-k="date"]').fill("2026-11-20");
  await q.locator('[data-k="paying"]').fill("10");
  await q.locator('[data-item="hf"]').check();
  await q.locator('[data-item="tea"]').check();
  // No drafts: there's no save - generating is what creates it.
  await expect(page.locator('#invoicer [data-act="save-quote"]')).toHaveCount(0);
  await expect(page.locator("#iv-refs")).toHaveText("");

  // Step 1 -> 2.
  await act(page, "generate-quote");
  await expectStage(page, 1);
  await expect(page.locator("#iv-refs")).toHaveText(/^Q-\d{4}-\d{4}$/);
  await expect(page.locator("#iv-quote .iv-lines-doc dd.total")).toHaveText("£34.00");   // 30 + 4 per head
  await expect(page.locator("#iv-qpill")).toBeEmpty();
  await expect(fstep(page, 1)).toContainText(/Q-\d{4}-\d{4} generated/);
  await expect(page.locator('#iv-flow [data-act="back-quote"]')).toHaveText("Edit the quote");
  await expect(page.locator("#iv-qform")).toHaveCount(0);           // the quote is closed now

  const [qpdf] = await Promise.all([page.waitForEvent("download"), act(page, "pdf-quote")]);
  expect(qpdf.suggestedFilename()).toMatch(/^Q-\d{4}-\d{4} Quote - E2E event .*\.pdf$/);
  expect((await require("fs").promises.readFile(await qpdf.path())).subarray(0, 5).toString()).toBe("%PDF-");

  // Step 2: generating without the invoice details says what's missing.
  await act(page, "generate-invoice");
  await expect(page.locator("#iv-flow .iv-problem")).toContainText("Paying attendees on the day");
  await expectStage(page, 1);
  await page.locator('#iv-iform [data-k="actual"]').fill("9");
  await act(page, "generate-invoice");
  await answer(page, true, "Generate the invoice?");
  await expectStage(page, 2);
  await expect(page.locator("#iv-refs")).toHaveText(/^Q-\d{4}-\d{4} · INV-\d{4}-\d{4}$/);
  await expect(page.locator("#iv-invoice .iv-lines-doc dd.total")).toHaveText("£367.20");   // 34 x 9 = 306 + 20% VAT
  await expect(page.locator("#iv-quote .iv-lines-doc dd.total")).toHaveText("£34.00");      // quote unchanged
  // Once invoiced, going back is to the invoice (warned), not the quote -
  // and it keeps its number when generated again.
  await expect(page.locator('#iv-flow [data-act="back-quote"]')).toHaveCount(0);
  const refs = await page.locator("#iv-refs").textContent();
  await act(page, "back-invoice");
  await answer(page, true, "may already have been sent");
  await expectStage(page, 1);
  await expect(page.locator('#iv-iform [data-k="actual"]')).toHaveValue("9");
  await act(page, "generate-invoice");
  await answer(page);
  await expectStage(page, 2);
  await expect(page.locator("#iv-refs")).toHaveText(refs);

  const [ipdf] = await Promise.all([page.waitForEvent("download"), act(page, "pdf-invoice")]);
  expect(ipdf.suggestedFilename()).toMatch(/^INV-\d{4}-\d{4} Invoice - /);

  // Step 3: paid, undo (warned), paid again.
  await act(page, "paid");
  await expectStage(page, 3);
  await act(page, "unpaid");
  await answer(page);
  await expectStage(page, 2);
  await act(page, "paid");
  await expectStage(page, 3);
  await act(page, "close");

  const row = page.locator(`#pane-invoices .irow:has-text("${title}")`);
  await expect(row.locator(".iv-pstep.done")).toHaveCount(3);
  await expect(row.locator('.iv-pstep[data-s="paid"]')).toHaveClass(/\bdone\b/);
  await expect(row.locator(".amt")).toHaveText("£367.20");

  // From the list, without opening it: the Quote and Invoice steps are PDF links.
  const [q2] = await Promise.all([page.waitForEvent("download"), row.locator('[data-pdf="quote"]').click()]);
  expect(q2.suggestedFilename()).toMatch(/^Q-\d{4}-\d{4} Quote - /);
  const [i2] = await Promise.all([page.waitForEvent("download"), row.locator('[data-pdf="invoice"]').click()]);
  expect(i2.suggestedFilename()).toMatch(/^INV-\d{4}-\d{4} Invoice - /);
  await expect(page.locator("#invoicer")).toBeHidden();
});

test("editing a generated quote in place keeps its number", async ({ page, request }) => {
  await signIn(page, ADMIN);
  await pickView(page, "Invoices");
  await expandAll(page, "pane-invoices");
  const title = "E2E steps " + Date.now();
  const type = await typeNamed(request, await apiToken(request), "Other");
  await page.click("#edit-toggle");
  await page.locator(`#pane-invoices [data-new-inv="${type.id}"]`).click();
  await page.click('#iv-flow [data-model="item"]');
  const q = page.locator("#iv-qform");
  await q.locator('[data-k="title"]').fill(title);
  await q.locator('[data-k="client"]').fill("E2E");
  await q.locator('[data-k="date"]').fill("2026-12-02");
  // A price-list line: its price is locked (no price field to edit).
  await q.locator('[data-add-line="lines"]:not([data-kind])').click();
  const known = q.locator('.iv-line[data-list="lines"]').nth(0);
  await expect(known.locator('input[data-lk="price"]')).toHaveAttribute("type", "hidden");
  await expect(known.locator(".iv-locked")).toBeVisible();
  await known.locator('[data-lk="qty"]').fill("2");
  // A custom line has its own description and price.
  await q.locator('[data-add-line="lines"][data-kind="custom"]').click();
  const custom = q.locator('.iv-line[data-list="lines"]').nth(1);
  await custom.locator('[data-lk="desc"]').fill("Thing");
  await custom.locator('[data-lk="price"]').fill("100");
  await act(page, "generate-quote");                                // straight from unsaved to generated
  await expectStage(page, 1);
  await expect(page.locator("#iv-quote .iv-lines-doc dt").nth(1)).toContainText("Thing");
  await expect(fstep(page, 2)).toContainText("actual quantities");

  const ref = await page.locator("#iv-refs").textContent();

  // Editing is warned, and reopens the quote's form - it stays generated.
  await act(page, "back-quote");
  await answer(page, true, "may already have been sent");
  await expectStage(page, 0);
  await expect(page.locator('#iv-qform [data-k="title"]')).toHaveValue(title);
  await expect(page.locator("#iv-qpill")).toHaveText("As last generated");
  // Cancel drops the changes.
  await page.locator('#iv-qform [data-k="client"]').fill("E2E changed");
  await act(page, "cancel-edit");
  await answer(page, true, "Discard your changes");
  await expectStage(page, 1);
  // Re-generating keeps the number.
  await act(page, "back-quote");
  await answer(page);
  await page.locator('#iv-qform [data-k="client"]').fill("E2E re-generated");
  await act(page, "generate-quote");
  await expectStage(page, 1);
  await expect(page.locator("#iv-refs")).toHaveText(ref);
  await expect(page.locator("#iv-quote")).toContainText("E2E re-generated");
});

test("an incomplete quote can't be generated, and nothing is saved before it is", async ({ page }) => {
  await signIn(page, ADMIN);
  await pickView(page, "Invoices");
  await expandAll(page, "pane-invoices");
  const title = "E2E unsaved " + Date.now();
  await page.click("#edit-toggle");
  await page.locator('#pane-invoices .grouphead:has(.gtitle[value="Other"]) + .gcard [data-new-inv]').click();
  await page.click('#iv-flow [data-model="item"]');
  await page.locator('#iv-qform [data-k="title"]').fill(title);
  await act(page, "generate-quote");
  await expect(page.locator("#iv-flow .iv-problem")).toContainText("Client");
  await expect(page.locator("#iv-refs")).toHaveText("");            // nothing saved
  await act(page, "close");
  await answer(page, true, "Discard your unsaved changes?");
  await expect(page.locator("#invoicer")).toBeHidden();
  await expect(page.locator(`#pane-invoices .irow:has-text("${title}")`)).toHaveCount(0);
  await page.click("#edit-toggle");
});

test("edit mode: deleting a type and closing an edited pop-up both ask in-app", async ({ page }) => {
  await signIn(page, ADMIN);
  await pickView(page, "Invoices");
  await expandAll(page, "pane-invoices");
  await page.click("#edit-toggle");

  // A new, empty type can be deleted - after saying so.
  const types = page.locator("#pane-invoices .grouphead");
  const before = await types.count();
  await page.click("#pane-invoices [data-add-type]");
  await expect(types).toHaveCount(before + 1);
  const del = page.locator("#pane-invoices [data-deltype]").last();
  await del.click();
  await answer(page, false);                                        // Cancel keeps it
  await expect(del).toBeVisible();
  await del.click();
  await answer(page, true, "Delete the invoice type");
  await expect(types).toHaveCount(before);

  // A pop-up with unsaved changes asks before closing, and Discard closes it.
  await page.locator("#pane-invoices [data-new-inv]").first().click();
  await page.click('#iv-flow [data-model="item"]');
  await page.locator('#iv-qform [data-k="title"]').fill("E2E not saved");
  await page.click("#iv-close");
  await answer(page, false);                                        // Cancel keeps it open
  await expect(page.locator("#invoicer")).toBeVisible();
  await page.keyboard.press("Escape");
  await answer(page, true, "Discard your unsaved changes?");
  await expect(page.locator("#invoicer")).toBeHidden();
  await page.click("#edit-toggle");
});

test("server rules: refs, frozen invoices, going back, deleting", async ({ request }) => {
  const token = await apiToken(request);
  const h = { headers: { Authorization: token } };
  const type = await eventType(request, token);
  const url = `${PB}/api/collections/invoices/records`;

  expect((await request.post(url, { ...h, data: { type: type.id, status: "quoted", title: "E2E rules", quote_ref: "HACK-1" } })).status()).toBe(400);
  // No drafts: a record can only be created already generated.
  expect((await request.post(url, { ...h, data: { type: type.id, status: "draft", title: "E2E rules" } })).status()).toBe(400);
  const rec = await (await request.post(url, { ...h, data: { type: type.id, status: "quoted", title: "E2E rules" } })).json();
  expect(rec.quote_ref).toMatch(/^Q-\d{4}-\d{4}$/);
  expect(rec.quoted_at).not.toBe("");                              // stamped by the server

  const inv = await (await request.patch(`${url}/${rec.id}`, { ...h, data: { status: "invoiced" } })).json();
  expect(inv.invoice_ref).toMatch(/^INV-\d{4}-\d{4}$/);
  expect((await request.patch(`${url}/${rec.id}`, { ...h, data: { title: "E2E rules changed" } })).status()).toBe(400);
  expect((await request.patch(`${url}/${rec.id}`, { ...h, data: { status: "draft" } })).status()).toBe(400);
  expect((await request.patch(`${url}/${rec.id}`, { ...h, data: { status: "cancelled" } })).status()).toBe(400);   // no such status
  // Going back to quoted is allowed, keeps the number, and gets it again.
  const back = await request.patch(`${url}/${rec.id}`, { ...h, data: { status: "quoted", invoiced_at: "" } });
  expect(back.status()).toBe(200);
  expect((await back.json()).invoice_ref).toBe(inv.invoice_ref);
  const again = await (await request.patch(`${url}/${rec.id}`, { ...h, data: { status: "invoiced" } })).json();
  expect(again.invoice_ref).toBe(inv.invoice_ref);
  // An issued invoice can be deleted by an admin (no "cancelled" any more).
  expect((await request.delete(`${url}/${rec.id}`, h)).status()).toBe(204);
});

test("a generated invoice can be deleted from the pop-up, with a warning", async ({ page, request }) => {
  const token = await apiToken(request);
  const type = await eventType(request, token);
  const title = "E2E delete issued " + Date.now();
  const url = `${PB}/api/collections/invoices/records`;
  const rec = await (await request.post(url, { headers: { Authorization: token },
    data: { type: type.id, status: "invoiced", title, client: "E2E Client", details: { model: "item", lines: [] } } })).json();

  await signIn(page, ADMIN);
  await pickView(page, "Invoices");
  await expandAll(page, "pane-invoices");
  await page.locator(`#pane-invoices .irow[data-open-inv="${rec.id}"] .ttl`).click();
  await expect(page.locator('#invoicer [data-act="delete"]')).toHaveText("Delete invoice");
  await act(page, "delete");
  await answer(page, false, "may already have been sent");        // Cancel keeps it
  await expect(page.locator("#invoicer")).toBeVisible();
  await act(page, "delete");
  await answer(page, true);
  await expect(page.locator("#invoicer")).toBeHidden();
  await expect(page.locator(`#pane-invoices .irow[data-open-inv="${rec.id}"]`)).toHaveCount(0);
});

test("changing prices doesn't change an existing quote", async ({ page, request }) => {
  const token = await apiToken(request);
  const type = await eventType(request, token);
  const prices = await priceList(request, token);
  const original = prices.attendee;
  try{
    await signIn(page, ADMIN);
    await pickView(page, "Invoices");
    await expandAll(page, "pane-invoices");
    const title = "E2E snapshot " + Date.now();
    await page.click("#edit-toggle");
    await page.locator(`#pane-invoices [data-new-inv="${type.id}"]`).click();
    await page.click('#iv-flow [data-model="attendee"]');
    const form = page.locator("#iv-qform");
    await form.locator('[data-k="title"]').fill(title);
    await form.locator('[data-k="client"]').fill("E2E");
    await form.locator('[data-k="date"]').fill("2026-12-01");
    await form.locator('[data-item="hf"]').check();
    await page.click('#invoicer [data-act="generate-quote"]');
    await expect(page.locator("#iv-quote .iv-lines-doc dd.total")).toHaveText("£30.00");
    await page.click('#invoicer [data-act="close"]');

    // Raise the room price in the prices editor.
    await page.click("#pane-invoices [data-prices]");
    await page.locator('#rt-items .rt-row[data-sec="attendee"][data-i="0"] [data-rk="full"]').fill("99");
    await page.click('[data-rt="save"]');
    await expect(page.locator("#rates-editor")).toBeHidden();
    await page.click("#edit-toggle");

    // The generated quote still shows the old price.
    await page.locator(`#pane-invoices .irow:has-text("${title}") .ttl`).click();
    await expect(page.locator("#iv-quote .iv-lines-doc dd.total")).toHaveText("£30.00");
  } finally {
    await request.patch(`${PB}/api/collections/price_list/records/${prices.id}`,
      { headers: { Authorization: token }, data: { attendee: original } });
  }
});
