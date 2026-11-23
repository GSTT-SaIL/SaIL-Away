/* The invoicer pop-up: one quote/invoice record. Three panes - details
   (left), quote (middle), invoice (right) - after the standalone Invoicer.

   The details pane is a FLOW: three steps, and only the one that's due can
   be filled in or acted on.

     1 Quote details    first, what kind of quote (per attendee, or per
                        item/hour - models/), then its fields; Generate
                        quote. There are NO drafts (the user's call,
                        2026-10-03): nothing is saved until the quote is
                        generated - generating is what creates the record.
     2 Invoice details  only what the invoice needs (the model's
                        invoiceForm - attendees on the day, actual time,
                        extra charges); Save / Generate invoice
     3 Payment          Mark as paid

   Finished steps collapse to a summary; later steps show as locked. Going
   back is possible but warned: "Edit the quote" reopens a generated quote's
   form in place (S.editingQuote) - it stays generated and keeps its number;
   "Re-generate quote" saves it with today's date and the current price
   list, "Cancel" drops the changes. "Go back and edit the invoice"
   un-generates the invoice (it keeps its number, and gets it again when
   re-generated), and paid can be undone. Anything can be deleted (top right) - warned
   more strongly once it's been generated, since it may have been sent.
   The flow is the only progress display here; the list rows carry the
   compact bar.
   The step reached is invoices.status (stages.js); the server enforces the
   same rules (pb_hooks/invoices.pb.js).

   - The quote and invoice panes only change on save, never live, and are
     drawn from the record's own copy of the prices (`rates`). That copy is
     taken from the shared price list when the quote is generated (and
     re-generated), so a quote's figures never shift when the list changes.
   - Forms, checks and documents come from the quote's pricing model
     (models/), so this file works the same for both. The invoice type
     (the group) is just a category - it doesn't change the form.

   Builds its own markup on init(); open(record, type, prices, onChange)
   shows it (prices = the price_list record).
   onChange(record) is called after every save/status change, and
   onChange(null, id) after a delete, so the list can update. */
import { pb } from "../../core/pb.js";
import { canEdit as mayEdit } from "../../core/site.js";
import { esc } from "../../core/util.js";
import { reportSaveError } from "../../core/shell.js";
import { inPeriod, outsideMessage } from "../../core/period.js";
import { ask, tell } from "../../core/dialog.js";
import { MODELS, modelFor } from "./models/index.js";
import { fmtDate } from "./common.js";
import { downloadPdf } from "./pdf.js";
import { STEPS, STATUS, stage } from "./stages.js";

export { STATUS };

const $ = id => document.getElementById(id);
let S = null;          // { rec, type, prices, calc (the pricing model, or null until chosen), details, dirty, onChange, problem, editingQuote }
let lastFocus = null;

// Prices to draw with: the current price list for a quote being written
// (new, or a generated one being edited), the record's saved copy otherwise.
const priceCtx = () => ({ attendee: S.prices.attendee || [], items: S.prices.items || [], vat: S.prices.vat, valid: S.prices.valid_days });
const recCtx = () => S.rec && S.rec.rates && (S.rec.rates.attendee || S.rec.rates.items)
  ? { attendee: S.rec.rates.attendee || [], items: S.rec.rates.items || [], vat: S.rec.rates.vat, valid: S.rec.rates.valid } : priceCtx();
const writingQuote = () => !S.rec || S.editingQuote;
const liveCtx = () => writingQuote() ? priceCtx() : recCtx();
const meta = () => ({
  quoteRef: S.rec?.quote_ref, invoiceRef: S.rec?.invoice_ref,
  issued: S.rec?.quoted_at || S.rec?.updated, invoiced: S.rec?.invoiced_at,
});

/* ------------------------------- documents ------------------------------ */
function docHTML(m, pdfAct){
  return `<div class="iv-doc">
    <h3 class="iv-doc-title">${esc(m.title)}</h3>
    <div class="iv-doc-ref">${esc(m.meta)}</div>
    <dl class="iv-facts">${m.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "")}</dd>`).join("")}</dl>
    <dl class="iv-lines-doc">
      ${m.lines.map(l => `<dt>${esc(l.name)}${l.sub ? `<small>${esc(l.sub)}</small>` : ""}</dt><dd>${esc(l.amount)}</dd>`).join("")}
      ${m.rows.map(([k, v]) => `<dt class="soft">${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}
      <dt class="total">${esc(m.total[0])}</dt><dd class="total">${esc(m.total[1])}</dd>
    </dl>
    ${m.note ? `<p class="iv-small">${esc(m.note)}</p>` : ""}
    ${m.terms ? `<div class="iv-terms"><p>${esc(m.terms.lead)}</p><ul>${m.terms.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>${m.terms.after ? `<p>${esc(m.terms.after)}</p>` : ""}</div>` : ""}
    ${pdfAct ? `<div class="iv-doc-foot"><button type="button" class="sbtn" data-act="${pdfAct}">Download PDF</button></div>` : ""}
  </div>`;
}
const incompleteHTML = (title, missing, hint) => `<div class="iv-incomplete"><div class="big">${esc(title)}</div>
  <p>${esc(hint)}</p>${missing.length ? `<ul>${missing.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
const pill = (cls, text) => `<span class="iv-pill ${cls}">${esc(text)}</span>`;

function renderDocs(){
  const r = S.rec;
  if(!r || !S.calc){
    $("iv-qpill").innerHTML = ""; $("iv-ipill").innerHTML = "";
    $("iv-quote").innerHTML = incompleteHTML("No quote yet", [], "Fill in the quote details and generate it - it appears here.");
    $("iv-invoice").innerHTML = incompleteHTML("No invoice yet", [], "The invoice follows from the quote.");
    return;
  }
  const d = r.details || {}, ctx = recCtx();
  const qMissing = S.calc.missingQuote(d, ctx);
  if(qMissing.length){
    $("iv-qpill").innerHTML = pill("iv-st-warn", "Incomplete");
    $("iv-quote").innerHTML = incompleteHTML("Quote incomplete", qMissing, "Add these in the quote details, then save.");
  } else {
    // While it's being edited, this is still the quote as last generated.
    $("iv-qpill").innerHTML = S.editingQuote ? pill("iv-st-draft", "As last generated") : "";
    $("iv-quote").innerHTML = docHTML(S.calc.quote(d, ctx, meta()), "pdf-quote");
  }

  if(r.invoice_ref && r.status !== "quoted"){   // (quoted with a ref = invoice taken back for editing)
    $("iv-ipill").innerHTML = "";
    $("iv-invoice").innerHTML = docHTML(S.calc.invoice(d, ctx, meta()), "pdf-invoice");
  } else if(r.status === "quoted" && !S.calc.missingInvoice(d, ctx).length){
    $("iv-ipill").innerHTML = pill("iv-st-draft", "Preview");
    $("iv-invoice").innerHTML = docHTML(S.calc.invoice(d, ctx, meta()), null)
      + `<p class="iv-hint iv-preview-note">Generate the invoice (step 2 on the left) to number it and download it.</p>`;
  } else {
    $("iv-ipill").innerHTML = "";
    $("iv-invoice").innerHTML = incompleteHTML("No invoice yet",
      r.status === "quoted" ? S.calc.missingInvoice(d, ctx) : [],
      r.status === "quoted" ? "Add the invoice details (step 2 on the left)."
        : "The invoice follows once the quote is generated.");
  }
}

/* -------------------------------- header -------------------------------- */
function renderHead(){
  const r = S.rec;
  $("iv-title").textContent = (S.details.title || (r && r.title)) || "New quote";
  $("iv-refs").textContent = [r?.quote_ref, r?.invoice_ref].filter(Boolean).join(" · ");
  const tp = $("iv-type");
  tp.textContent = S.type.name; tp.style.background = S.type.tint; tp.style.color = S.type.ink;

  // Progress is shown by the flow itself. Up here: delete, at any stage.
  $("iv-side").innerHTML = r && mayEdit()
    ? `<button type="button" class="sbtn link danger" data-act="delete">Delete ${r.invoice_ref && r.status !== "quoted" ? "invoice" : "quote"}</button>`
    : "";
}

/* --------------------------------- flow --------------------------------- */

function stepHTML(st, state, title, body){
  return `<section class="iv-fstep ${state}" data-fstep="${st.n}" style="--c:${st.colour}" aria-label="Step ${st.n}: ${esc(title)}">
    <div class="iv-fhead">
      <span class="iv-fdot" aria-hidden="true">${state === "done" ? "&#10003;" : st.n}</span>
      <h4>${esc(title)}</h4>
    </div>
    <div class="iv-fbody">${body}</div>
  </section>`;
}

function renderFlow(){
  const r = S.rec;
  const canEdit = mayEdit();          // viewers see the flow, but can't act on it
  // A generated quote being edited shows step 1 open again, later steps locked.
  const cur = r && !S.editingQuote ? stage(r.status) : 0;   // steps before `cur` are done; step cur+1 is due
  const state = n => n <= cur ? "done" : n === cur + 1 ? "active" : "locked";
  const problem = n => S.problem && S.problem.step === n
    ? `<div class="iv-problem" role="alert"><strong>${esc(S.problem.title)}</strong><ul>${S.problem.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  const ctx = liveCtx();

  // ---- 1 Quote details: first the kind of quote, then its fields ----
  let b1;
  const viewOnly = `<p class="iv-flocked">Only admins can change quotes and invoices.</p>`;
  if(state(1) === "active" && !canEdit) b1 = viewOnly;
  else if(state(1) === "active" && !S.calc) b1 = `<p class="iv-fintro">What kind of quote is this?</p>
      <div class="iv-choose">${Object.values(MODELS).map(m => `<button type="button" class="iv-choice" data-model="${m.key}">
          <strong>${esc(m.label)}</strong><span>${esc(m.description)}</span></button>`).join("")}</div>`;
  else if(state(1) === "active") b1 = `<p class="iv-kind">${esc(S.calc.label)} <button type="button" class="iv-back" data-act="change-model">Change</button></p>
      <fieldset id="iv-qform">${S.calc.form(S.details, ctx)}</fieldset>${problem(1)}
      <p class="iv-hint">${r
        ? `Re-generating keeps ${esc(r.quote_ref)} and gives it today's date and the current prices.`
        : "Nothing is saved until the quote is generated."}</p>
      <div class="iv-factions">
        ${r ? `<button type="button" class="sbtn" data-act="cancel-edit">Cancel</button>` : ""}
        <button type="button" class="sbtn iv-go" data-act="generate-quote">${r ? "Re-generate quote" : "Generate quote"} &rarr;</button>
      </div>`;
  else b1 = `<p class="iv-fsum">${esc(r.quote_ref)} generated ${esc(fmtDate(r.quoted_at || r.updated))}.</p>
      ${state(2) === "active" && canEdit ? `<button type="button" class="iv-back" data-act="back-quote">Edit the quote</button>` : ""}`;

  // ---- 2 Invoice details ----
  let b2;
  if(state(2) === "active" && !canEdit) b2 = viewOnly;
  else if(state(2) === "active"){
    const form = S.calc.invoiceForm ? S.calc.invoiceForm(S.details, recCtx()) : "";
    b2 = (form
        ? `<p class="iv-fintro">Add ${esc(S.calc.invoiceDetails || "what the invoice needs")}. The quote stays as it was sent.</p><fieldset id="iv-iform">${form}</fieldset>`
        : `<p class="iv-fintro">Nothing else is needed - the invoice matches the quote.</p>`)
      + problem(2)
      + `<div class="iv-factions">
        ${form ? `<button type="button" class="sbtn" data-act="save-invoice">Save</button>` : ""}
        <button type="button" class="sbtn iv-go" data-act="generate-invoice">Generate invoice &rarr;</button>
      </div>`;
  }
  else if(state(2) === "done") b2 = `<p class="iv-fsum">${esc(r.invoice_ref)} generated ${esc(fmtDate(r.invoiced_at))}.</p>
      ${state(3) === "active" && canEdit ? `<button type="button" class="iv-back" data-act="back-invoice">Go back and edit the invoice</button>` : ""}`;
  else b2 = `<p class="iv-flocked">Opens once the quote is generated.</p>`;

  // ---- 3 Payment ----
  let b3;
  if(state(3) === "active" && !canEdit) b3 = viewOnly;
  else if(state(3) === "active") b3 = `<p class="iv-fintro">When ${esc(r.client || "the client")} has paid ${esc(r.invoice_ref)}:</p>
      <div class="iv-factions"><button type="button" class="sbtn iv-go" data-act="paid">Mark as paid &rarr;</button></div>`;
  else if(state(3) === "done") b3 = `<p class="iv-fsum">Paid.</p>${canEdit ? `<button type="button" class="iv-back" data-act="unpaid">Undo - it wasn't paid</button>` : ""}`;
  else b3 = `<p class="iv-flocked">Opens once the invoice is generated.</p>`;

  $("iv-flow").innerHTML = stepHTML(STEPS[0], state(1), "Quote details", b1)
    + stepHTML(STEPS[1], state(2), "Invoice details", b2)
    + stepHTML(STEPS[2], state(3), "Payment", b3);
}

function render(){ renderHead(); renderFlow(); renderDocs(); }

// Re-draw the flow from what's been typed so far (after adding/removing a
// line, ticking an item, changing dates ...), keeping the scroll position.
function redrawFlow(){
  const body = $("iv-entry-body"), top = body.scrollTop;
  renderFlow();
  body.scrollTop = top;
}
// Pull whatever is typed in the open step's form into S.details.
function readOpen(){
  if($("iv-qform")) S.details = { ...S.details, ...S.calc.read($("iv-qform")) };
  if($("iv-iform") && S.calc.readInvoice) S.details = S.calc.readInvoice($("iv-iform"), S.details);
}

/* -------------------------------- saving -------------------------------- */
async function persist(extra = {}){
  // The date files the quote under a financial year; it must be the one on
  // show, or the quote would vanish from the list once saved.
  if(S.details.date && !inPeriod(S.details.date)){
    S.problem = { step: 1, title: "Change the date first:", items: [outsideMessage(S.details.date)] };
    redrawFlow();
    return false;
  }
  // Writing the quote (new, or re-generating): prices from the price list.
  const fresh = writingQuote();
  const ctx = fresh ? priceCtx() : recCtx();
  const d = S.details;
  const sum = S.calc.summary(d, ctx);
  const payload = {
    title: sum.title || "", client: sum.client || "", date: sum.date || "",
    details: d, quote_amount: sum.quoteAmount || 0, quote_label: sum.quoteLabel || "", invoice_total: sum.invoiceTotal || 0,
    ...extra,
  };
  // Prices are copied from the price list when the quote is (re-)generated.
  if(fresh) payload.rates = { attendee: S.prices.attendee || [], items: S.prices.items || [], vat: S.prices.vat, valid: S.prices.valid_days };
  try{
    S.rec = S.rec
      ? await pb.collection("invoices").update(S.rec.id, payload)
      : await pb.collection("invoices").create({ ...payload, type: S.type.id });
  }catch(err){ reportSaveError(err); return false; }
  S.details = S.rec.details || {};
  S.dirty = false; S.problem = null; S.editingQuote = false;
  render();
  S.onChange?.(S.rec);
  return true;
}

async function setStatus(status, extra = {}){
  try{
    S.rec = await pb.collection("invoices").update(S.rec.id, { status, ...extra });
  }catch(err){ reportSaveError(err); return; }
  S.problem = null;
  render();
  S.onChange?.(S.rec);
}

/* -------------------------------- actions ------------------------------- */
async function act(a){
  const r = S.rec;
  if(a === "close") return close();
  // Viewers can read and download; nothing else.
  if(!mayEdit() && a !== "pdf-quote" && a !== "pdf-invoice") return;

  if(a === "change-model"){
    readOpen();
    const d = S.details;
    const started = (d.lines || []).length || (d.custom || []).length || Object.keys(d.items || {}).length;
    if(started && !await ask("Change the kind of quote? The items you've added will be cleared (the name, client and date are kept).", { ok: "Change" })) return;
    S.details = { title: d.title || "", client: d.client || "", date: d.date || "" };
    S.calc = null; S.dirty = true; S.problem = null;
    return redrawFlow();
  }
  // Generating creates the record (there are no drafts); on a generated
  // quote being edited it re-generates it - same number, new date and prices.
  if(a === "generate-quote"){
    readOpen();
    const missing = S.calc.missingQuote(S.details, priceCtx());
    if(missing.length){ S.problem = { step: 1, title: "Before the quote can be generated:", items: missing }; redrawFlow(); return; }
    return persist({ status: "quoted", quoted_at: new Date().toISOString() });
  }
  if(a === "back-quote"){
    if(S.dirty && !await ask("Discard the invoice details you haven't saved?", { ok: "Discard", danger: true })) return;
    if(!await ask(`Edit the quote?\n\n${r.quote_ref} may already have been sent to ${r.client || "the client"}. It keeps its number; when you re-generate it, it takes today's date and the current prices - send them the new version.`, { ok: "Edit quote" })) return;
    S.editingQuote = true;
    S.details = JSON.parse(JSON.stringify(r.details || {}));
    S.calc = modelFor(S.details.model) || MODELS.item;
    S.dirty = false; S.problem = null;
    render();
    $("iv-qform")?.querySelector("input")?.focus();
    return;
  }
  if(a === "cancel-edit"){
    if(S.dirty && !await ask("Discard your changes to the quote?", { ok: "Discard", danger: true })) return;
    S.editingQuote = false;
    S.details = r.details || {};
    S.calc = modelFor(S.details.model) || MODELS.item;
    S.dirty = false; S.problem = null;
    return render();
  }

  if(a === "back-invoice"){
    if(!await ask(`Go back and edit the invoice?

${r.invoice_ref} may already have been sent to ${r.client || "the client"}. It keeps its number - when you generate it again, send them the corrected version.`, { ok: "Go back" })) return;
    return setStatus("quoted", { invoiced_at: "" });
  }
  if(a === "save-invoice"){ readOpen(); return persist(); }
  if(a === "generate-invoice"){
    readOpen();
    const missing = S.calc.missingInvoice(S.details, recCtx());
    if(missing.length){ S.problem = { step: 2, title: "Before the invoice can be generated:", items: missing }; redrawFlow(); return; }
    if(!await ask("Generate the invoice? It gets an invoice number, and its figures are locked from then on.", { ok: "Generate invoice" })) return;
    return persist({ status: "invoiced", invoiced_at: new Date().toISOString(),
      invoice_total: S.calc.summary(S.details, recCtx()).invoiceTotal || 0 });
  }

  if(a === "paid") return setStatus("paid");
  if(a === "unpaid"){
    if(!await ask(`Mark ${r.invoice_ref} as not paid?`, { ok: "Mark not paid" })) return;
    return setStatus("invoiced");
  }
  if(a === "delete"){
    const name = r.title ? `"${r.title}"` : "this";
    // Everything saved has been generated, so it may have gone out.
    const sent = `\n\n${r.invoice_ref || r.quote_ref} may already have been sent to ${r.client || "the client"}.`;
    if(!await ask(`Delete ${name}? This can't be undone.${sent}`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection("invoices").delete(r.id); }catch(err){ reportSaveError(err); return; }
    S.onChange?.(null, r.id);
    close(true);
    return;
  }
  if(a === "pdf-quote" || a === "pdf-invoice"){
    await downloadDoc(r, a === "pdf-quote" ? "quote" : "invoice");
  }
}

/* --------------------------------- api ---------------------------------- */
// Download a record's quote or invoice PDF without opening the pop-up (the
// list's progress bar uses this too). Drawn from the record's own saved
// prices, exactly as the pop-up shows it. Resolves false if it failed.
export async function downloadDoc(rec, kind){
  const calc = modelFor(rec.details?.model) || MODELS.item;
  const r = rec.rates || {};
  const ctx = { attendee: r.attendee || [], items: r.items || [], vat: r.vat, valid: r.valid };
  const m = { quoteRef: rec.quote_ref, invoiceRef: rec.invoice_ref, issued: rec.quoted_at || rec.updated, invoiced: rec.invoiced_at };
  const d = rec.details || {};
  try{ await downloadPdf(kind === "quote" ? calc.quote(d, ctx, m) : calc.invoice(d, ctx, m)); }
  catch(err){ tell("Couldn't create the PDF: " + (err.message || err)); return false; }
  return true;
}

// init: starting details for a new quote (the list passes a date inside the
// financial year on show).
export function open(rec, type, prices, onChange, init = {}){
  lastFocus = document.activeElement;
  const details = rec ? (rec.details || {}) : { ...init };
  // A new quote asks for its pricing model first (step 1). A saved one
  // always has one; if not, read it as per-item rather than break.
  const calc = modelFor(details.model) || (rec ? MODELS.item : null);
  S = { rec, type, prices: prices || {}, calc, details, dirty: false, onChange, problem: null, editingQuote: false };
  render();
  $("invoicer").hidden = false;
  document.body.classList.add("iv-open");
  ($("iv-flow").querySelector(".iv-fstep.active input, .iv-fstep.active select, .iv-fstep.active .iv-go") || $("iv-close"))?.focus();
}

export async function close(force = false){
  if(!S) return;
  if(!force && S.dirty && !await ask("Discard your unsaved changes?", { ok: "Discard", danger: true })) return;
  $("invoicer").hidden = true;
  document.body.classList.remove("iv-open");
  S = null;
  lastFocus?.focus?.();
}

export function init(){
  const el = document.createElement("div");
  el.id = "invoicer";
  el.className = "iv-backdrop";
  el.hidden = true;
  el.innerHTML = `
  <div class="iv-modal" role="dialog" aria-modal="true" aria-labelledby="iv-title">
    <div class="iv-head">
      <h2 id="iv-title"></h2>
      <span class="iv-refs" id="iv-refs"></span>
      <span class="iv-pill" id="iv-type"></span>
      <span class="iv-spacer"></span>
      <span class="iv-side" id="iv-side"></span>
      <button type="button" class="sbtn primary" id="iv-close" data-act="close">Close</button>
    </div>
    <div class="iv-panes">
      <section class="iv-pane iv-entry">
        <div class="iv-pane-head"><h3>Details</h3></div>
        <div class="iv-pane-body" id="iv-entry-body"><div class="iv-flow" id="iv-flow"></div></div>
      </section>
      <section class="iv-pane">
        <div class="iv-pane-head"><h3>Quote <span id="iv-qpill"></span></h3></div>
        <div class="iv-pane-body" id="iv-quote"></div>
      </section>
      <section class="iv-pane">
        <div class="iv-pane-head"><h3>Invoice <span id="iv-ipill"></span></h3></div>
        <div class="iv-pane-body" id="iv-invoice"></div>
      </section>
    </div>
  </div>`;
  document.body.appendChild(el);

  el.addEventListener("click", e => {
    if(!S) return;
    const a = e.target.closest("[data-act]");
    if(a && !a.disabled){ act(a.dataset.act); return; }
    const choice = e.target.closest("[data-model]");
    if(choice){
      S.calc = modelFor(choice.dataset.model);
      S.details = { ...S.calc.blank(), title: S.details.title || "", client: S.details.client || "", date: S.details.date || "" };
      S.dirty = true; redrawFlow();
      $("iv-qform")?.querySelector("input")?.focus();
      return;
    }
    // Add/remove a line in whichever step's form it's in.
    const add = e.target.closest("[data-add-line]");
    const rm = e.target.closest("[data-remove-line]");
    if(add || rm){
      readOpen();
      const list = (add || rm).dataset.addLine || (add || rm).dataset.removeLine;
      S.details[list] = add
        ? (S.details[list] || []).concat([S.calc.newLine(list, liveCtx(), add.dataset.kind)])
        : (S.details[list] || []).filter((_, j) => j !== Number(rm.dataset.i));
      S.dirty = true; redrawFlow();
    }
  });
  el.addEventListener("input", e => { if(S && e.target.closest("fieldset")) S.dirty = true; });
  // Ticking an item, changing a dropdown or a date can change prices or
  // totals shown in the form itself, so redraw it. (Not on text fields:
  // redrawing would move focus away mid-entry.)
  el.addEventListener("change", e => {
    if(!S || !e.target.closest("#iv-qform, #iv-iform")) return;
    const t = e.target;
    if(t.type === "checkbox" || t.tagName === "SELECT" || t.type === "date"){ readOpen(); redrawFlow(); }
  });
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && S && !$("invoicer").hidden){ e.stopPropagation(); close(); }
  }, true);
}

export const isOpen = () => !!S;
