/* Per-item / per-hour pricing - lines of things at a rate: people's time
   (per hour or day), kit hire (per day), services (each). Each line is
   either from the price list - its price is locked - or a custom line with
   its own description and price.
     quote   = sum of price x quantity, plus VAT
     invoice = the same lines at their ACTUAL quantity (blank = as quoted),
               plus any extra charges added afterwards (damage, late
               return, expenses), plus VAT

   ctx = { attendee, items: [price list items], vat, valid } */
import { esc } from "../../../core/util.js";
import { period } from "../../../core/period.js";
import { num, gbp, fmtDate, field, block, readFields, lines, readLines, quoteMeta, invoiceMeta, fileName, totals, plural } from "../common.js";

const UNIT = { hour: ["hour", "hours"], day: ["day", "days"], each: ["", ""] };
const per = u => u === "hour" ? "per hour" : u === "day" ? "per day" : "each";

function lineOf(l, byKey){
  const k = l.item && byKey[l.item];
  return k ? { name: k.name, price: num(k.price), unit: k.unit, known: true }
           : { name: l.desc || "", price: num(l.price), unit: "each", known: false };
}

function compute(d, ctx, actual){
  const byKey = Object.fromEntries((ctx.items || []).map(r => [r.key, r]));
  const out = (d.lines || []).map(l => {
    const x = lineOf(l, byKey);
    const qty = actual && l.actual !== "" && l.actual !== undefined ? num(l.actual) : num(l.qty);
    const u = UNIT[x.unit] || UNIT.each;
    const qtyText = x.unit === "each" ? (qty === 1 ? "" : `× ${qty}`) : `× ${plural(qty, u[0], u[1])}`;
    return { name: x.name, sub: qtyText ? `${gbp(x.price)} ${qtyText}` : "", amount: x.price * qty, ok: !!x.name };
  }).filter(l => l.ok);
  const extras = actual
    ? (d.extras || []).filter(e => e.desc || num(e.amount)).map(e => ({ name: e.desc || "Additional charge", sub: "", amount: num(e.amount) }))
    : [];
  const all = out.concat(extras);
  return { lines: all, sub: all.reduce((a, l) => a + l.amount, 0) };
}

export default {
  key: "item",
  label: "Per item or hour",
  description: "Lines of items, hours or days at a rate - consultancy, equipment hire, anything else.",
  invoiceDetails: "the actual quantities and any extra charges",

  blank: () => ({ model: "item", title: "", client: "", date: "", lines: [], extras: [] }),
  // kind "custom" starts a custom line; otherwise the first price list item.
  newLine: (list, ctx, kind) => list === "extras" ? { desc: "", amount: "" }
    : kind === "custom" ? { item: "", desc: "", qty: "1", price: "", actual: "" }
    : { item: ((ctx.items || [])[0] || {}).key || "", desc: "", qty: "1", price: "", actual: "" },

  form(d, ctx){
    const byKey = Object.fromEntries((ctx.items || []).map(r => [r.key, r]));
    const opts = (ctx.items || []).map(r => [r.key, `${r.name} - ${gbp(r.price)} ${per(r.unit)}`]);
    const rows = (d.lines || []).map((l, i) => {
      const k = l.item && byKey[l.item];
      const sel = `<select class="grow" data-lk="item" aria-label="Item">${
          opts.map(([v, t]) => `<option value="${esc(v)}"${v === l.item ? " selected" : ""}>${esc(t)}</option>`).join("")
        }<option value=""${k ? "" : " selected"}>Custom item&hellip;</option></select>`;
      const u = k ? (UNIT[k.unit] || UNIT.each)[1] : "";
      return `<div class="iv-line iv-iline" data-list="lines" data-i="${i}">
        ${sel}
        <input type="number" min="0" step="any" data-lk="qty" value="${esc(l.qty ?? "")}" aria-label="Quantity" title="${esc(u ? "Number of " + u : "Quantity")}">
        <button type="button" class="iv-x ibtn danger" data-remove-line="lines" data-i="${i}" aria-label="Remove line">&times;</button>
        ${k
          ? `<span class="iv-iline-note iv-locked">${esc(gbp(k.price))} ${esc(per(k.unit))}${u ? ` &middot; quantity in ${esc(u)}` : ""}</span>
             <input type="hidden" data-lk="desc" value=""><input type="hidden" data-lk="price" value="">`
          : `<span class="iv-iline-custom"><input type="text" data-lk="desc" value="${esc(l.desc || "")}" placeholder="Describe the item" aria-label="Description">
             <input type="number" min="0" step="0.01" data-lk="price" value="${esc(l.price ?? "")}" placeholder="£ each" aria-label="Price each"></span>`}
        <input type="hidden" data-lk="actual" value="${esc(l.actual ?? "")}">
      </div>`;
    }).join("");
    return block("Details", `<div class="iv-fields">
        ${field("What it's for", "title", d.title, { wide: true, placeholder: "e.g. Simulation programme review" })}
        ${field("Client", "client", d.client, { wide: true, placeholder: "Organisation or person paying" })}
        ${field("Date", "date", d.date, { type: "date", min: period.start, max: period.end })}
      </div>`)
      + block("Lines", `<div class="iv-lines">
          ${rows ? `<div class="iv-lhead iv-ihead"><span class="grow">Item</span><span>Qty</span><span></span></div>` : ""}
          ${rows || `<p class="iv-empty-line">No lines yet.</p>`}
          <div class="iv-addrow">
            ${opts.length ? `<button type="button" class="iv-add" data-add-line="lines">Add from the price list</button>` : ""}
            <button type="button" class="iv-add" data-add-line="lines" data-kind="custom">Add a custom line</button>
          </div>
        </div>`);
  },
  read(root){
    const d = readFields(root);
    d.lines = readLines(root, "lines");
    return d;
  },

  // Step 2: actual quantities (blank = as quoted) and extra charges.
  invoiceForm(d, ctx){
    const byKey = Object.fromEntries((ctx.items || []).map(r => [r.key, r]));
    const rows = (d.lines || []).map((l, i) => {
      const x = lineOf(l, byKey);
      if(!x.name) return "";
      const u = (UNIT[x.unit] || UNIT.each)[1];
      return `<label class="iv-actual"><span class="grow">${esc(x.name)}<small>Quoted ${esc(num(l.qty) + (u ? " " + u : ""))}</small></span>
        <input type="number" min="0" step="any" data-ai="${i}" value="${esc(l.actual ?? "")}" placeholder="As quoted" aria-label="Actual quantity for ${esc(x.name)}"></label>`;
    }).join("");
    return `<p class="iv-hint">Actual quantities - leave blank where it was as quoted.</p><div class="iv-actuals">${rows}</div>`
      + `<div class="iv-group-title" style="margin-top:16px">Extra charges</div>`
      + lines("extras", d.extras, [
          { k: "desc", label: "Charge", type: "text", grow: true, placeholder: "e.g. Late return, travel" },
          { k: "amount", label: "Amount £", type: "money" },
        ], { add: "Add an extra charge", empty: "Anything to add that wasn't on the quote." });
  },
  readInvoice(root, d){
    const ls = (d.lines || []).map(l => ({ ...l }));
    root.querySelectorAll("[data-ai]").forEach(el => { const l = ls[Number(el.dataset.ai)]; if(l) l.actual = el.value.trim(); });
    return { ...d, lines: ls, extras: readLines(root, "extras") };
  },

  missingQuote(d, ctx){
    const m = [];
    if(!d.title) m.push("What it's for");
    if(!d.client) m.push("Client");
    if(!d.date) m.push("Date");
    const byKey = Object.fromEntries((ctx.items || []).map(r => [r.key, r]));
    const ls = d.lines || [];
    if(!ls.some(l => num(l.qty) > 0 && lineOf(l, byKey).name)) m.push("At least one line with a quantity");
    if(ls.some(l => !(l.item && byKey[l.item]) && (!l.desc || l.price === "" || l.price === undefined)))
      m.push("A description and price for each custom line");
    return m;
  },
  missingInvoice(d, ctx){ return this.missingQuote(d, ctx); },

  quote(d, ctx, meta){
    const c = compute(d, ctx, false), t = totals(c.sub, ctx.vat, "Total");
    return {
      title: "Quote", meta: quoteMeta(meta, ctx.valid),
      facts: [["For", d.client], ["For work", d.title], ["Date", fmtDate(d.date)]],
      lines: c.lines.map(l => ({ name: l.name, sub: l.sub, amount: gbp(l.amount) })),
      rows: t.rows, total: t.total,
      note: "", terms: { lead: "You'll be invoiced for:", items: ["the actual quantities, at the prices above", "any agreed extra charges", "VAT at the applicable rate"], after: "" },
      file: fileName(meta.quoteRef, "Quote", d.title),
    };
  },
  invoice(d, ctx, meta){
    const c = compute(d, ctx, true), t = totals(c.sub, ctx.vat, "Total due");
    return {
      title: "Invoice", meta: invoiceMeta(meta),
      facts: [["Bill to", d.client], ["For work", d.title], ["Date", fmtDate(d.date)]],
      lines: c.lines.map(l => ({ name: l.name, sub: l.sub, amount: gbp(l.amount) })),
      rows: t.rows, total: t.total, note: "", terms: null,
      file: fileName(meta.invoiceRef, "Invoice", d.title),
    };
  },
  summary(d, ctx){
    const q = totals(compute(d, ctx, false).sub, ctx.vat, "");
    const i = totals(compute(d, ctx, true).sub, ctx.vat, "");
    return { title: d.title, client: d.client, date: d.date, quoteAmount: q.grand, quoteLabel: gbp(q.grand), invoiceTotal: i.grand };
  },
};
