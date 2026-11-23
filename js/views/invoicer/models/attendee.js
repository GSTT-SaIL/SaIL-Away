/* Per-attendee pricing - the standalone Invoicer's events model: charged per
   PAYING attendee. Known items come from the price list (full-day and
   half-day price per head per day) and their prices are locked; custom
   items carry their own price per head per day.
     per-head rate = sum of chosen items' prices x days
     invoice       = per-head rate x paying attendees on the day, plus VAT
   No minimum charge, deposit or margin (tried and removed in the Invoicer).

   ctx = { attendee: [price list items], items, vat, valid } */
import { esc } from "../../../core/util.js";
import { period } from "../../../core/period.js";
import { num, int, gbp, fmtDate, field, block, readFields, lines, readLines, quoteMeta, invoiceMeta, fileName } from "../common.js";

function compute(d, ctx){
  const half = d.length === "half";
  const days = Math.max(1, int(d.days) || 1);
  const chosen = d.items || {};
  const known = (ctx.attendee || []).filter(it => chosen[it.key]).map(it => ({ name: it.name, perDay: num(half ? it.half : it.full) }));
  const custom = (d.custom || []).filter(c => c.desc || num(c.price)).map(c => ({ name: c.desc || "Custom item", perDay: num(c.price) }));
  const out = known.concat(custom).map(l => ({ ...l, perHead: l.perDay * days }));
  return { half, days, lines: out, rate: out.reduce((a, l) => a + l.perHead, 0) };
}

export default {
  key: "attendee",
  label: "Per attendee",
  description: "Priced per paying attendee, per day - like an event or course.",
  invoiceDetails: "the number of paying attendees on the day",

  blank: () => ({ model: "attendee", title: "", client: "", date: "", paying: "", length: "full", days: "1", items: {}, custom: [], actual: "" }),
  newLine: () => ({ desc: "", price: "" }),

  form(d, ctx){
    const chosen = d.items || {};
    const half = d.length === "half";
    const rows = (ctx.attendee || []).map(it => `<label class="iv-row${chosen[it.key] ? "" : " off"}">
        <span class="iv-name">${esc(it.name)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span>
        <span class="iv-price iv-locked" title="Price list price">${gbp(half ? it.half : it.full).replace(".00", "")} pp</span>
        <input type="checkbox" class="iv-switch" data-item="${esc(it.key)}"${chosen[it.key] ? " checked" : ""}>
      </label>`).join("");
    return block("Event", `<div class="iv-fields">
        ${field("Event name", "title", d.title, { wide: true, placeholder: "e.g. Paediatric emergencies course" })}
        ${field("Organiser", "client", d.client, { wide: true, placeholder: "Organisation or person running it" })}
        ${field("Event date", "date", d.date, { type: "date", min: period.start, max: period.end })}
        ${field("Expected paying attendees", "paying", d.paying, { type: "number", min: 0, step: 1, placeholder: "Optional" })}
      </div>`)
      + block("From the price list", `<div class="iv-list">${rows || `<p class="iv-empty-line">The price list has no per-attendee items yet.</p>`}
        <label class="iv-row"><span class="iv-name">Session length</span><span class="iv-price"></span>
          <select data-k="length"><option value="full"${half ? "" : " selected"}>Full day</option><option value="half"${half ? " selected" : ""}>Half day</option></select></label>
        <label class="iv-row"><span class="iv-name">Days</span><span class="iv-price"></span>
          <input type="number" data-k="days" min="1" step="1" value="${esc(d.days || "1")}"></label>
      </div>`)
      + block("Custom items", lines("custom", d.custom, [
          { k: "desc", label: "Item", type: "text", grow: true, placeholder: "e.g. External speaker" },
          { k: "price", label: "£ per head", type: "money" },
        ], { add: "Add a custom item", empty: "Anything not on the price list, priced per paying attendee per day." }));
  },
  read(root){
    const d = readFields(root);
    d.items = {};
    root.querySelectorAll("[data-item]").forEach(el => { if(el.checked) d.items[el.dataset.item] = true; });
    d.custom = readLines(root, "custom");
    return d;
  },

  invoiceForm(d){
    return `<div class="iv-fields">
        ${field("Paying attendees on the day", "actual", d.actual, { type: "number", min: 0, step: 1, wide: true, placeholder: "How many paid for a ticket" })}
      </div>`;
  },
  readInvoice(root, d){ return { ...d, actual: root.querySelector('[data-k="actual"]').value.trim() }; },

  missingQuote(d, ctx){
    const m = [];
    if(!d.title) m.push("Event name");
    if(!d.client) m.push("Organiser");
    if(!d.date) m.push("Event date");
    if(!compute(d, ctx).lines.length) m.push("At least one item");
    if(!(int(d.days) >= 1)) m.push("Number of days");
    return m;
  },
  missingInvoice(d, ctx){
    const m = this.missingQuote(d, ctx);
    if(d.actual === "" || d.actual === undefined) m.push("Paying attendees on the day");
    return m;
  },

  quote(d, ctx, meta){
    const c = compute(d, ctx);
    const expected = d.paying === "" || d.paying === undefined ? null : Math.max(0, int(d.paying));
    return {
      title: "Quote",
      meta: quoteMeta(meta, ctx.valid),
      facts: [["For", d.client], ["Event", d.title], ["Date", fmtDate(d.date)], ["Session", `${c.days} × ${c.half ? "half day" : "full day"}`]],
      lines: c.lines.map(l => ({ name: l.name, sub: c.days > 1 ? `${gbp(l.perDay)} × ${c.days} days` : "", amount: gbp(l.perHead) })),
      rows: [],
      total: ["Per paying attendee", gbp(c.rate)],
      note: `Excludes VAT at ${num(ctx.vat)}%.` + (expected !== null ? ` At ${expected} paying attendees: ${gbp(c.rate * expected)}.` : ""),
      terms: { lead: "You'll be invoiced for:", items: ["the rate above times the number of paying attendees on the day", "VAT at the applicable rate"], after: "Attendees who did not pay for a ticket are not charged." },
      file: fileName(meta.quoteRef, "Quote", d.title),
    };
  },
  invoice(d, ctx, meta){
    const c = compute(d, ctx);
    const n = Math.max(0, int(d.actual));
    const sub = c.rate * n, vatPct = num(ctx.vat), vat = sub * vatPct / 100;
    return {
      title: "Invoice",
      meta: invoiceMeta(meta),
      facts: [["Bill to", d.client], ["Event", d.title], ["Date", fmtDate(d.date)], ["Paying attendees", String(n)]],
      lines: c.lines.map(l => ({ name: l.name, sub: `${gbp(l.perHead)} × ${n}`, amount: gbp(l.perHead * n) })),
      rows: [["Subtotal", gbp(sub)], [`VAT at ${vatPct}%`, gbp(vat)]],
      total: ["Total due", gbp(sub + vat)],
      note: "", terms: null,
      file: fileName(meta.invoiceRef, "Invoice", d.title),
    };
  },
  summary(d, ctx){
    const c = compute(d, ctx);
    const sub = c.rate * Math.max(0, int(d.actual));
    return {
      title: d.title, client: d.client, date: d.date,
      quoteAmount: c.rate, quoteLabel: c.lines.length ? gbp(c.rate) + " pp" : "",
      invoiceTotal: d.actual === "" || d.actual === undefined ? 0 : sub + sub * num(ctx.vat) / 100,
    };
  },
};
