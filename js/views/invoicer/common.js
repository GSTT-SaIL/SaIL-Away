/* Shared pieces for the invoicer pop-up and its pricing models: money and date
   formatting, form fields, the editable line lists, and the document model
   every pricing model produces (drawn on screen by popup.js and into the PDF
   by pdf.js - the same model, so the two always match). */
import { esc } from "../../core/util.js";

export const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
export const int = v => { const n = parseInt(v, 10); return isFinite(n) ? n : 0; };
export const gbp = v => "£" + num(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = d => {
  if(!d) return "";
  const x = new Date(d);
  return isNaN(x) ? "" : x.toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" });
};
export const newKey = () => Math.random().toString(36).slice(2, 9);
export const plural = (n, one, many = one+"s") => n + " " + (n === 1 ? one : many);

/* ------------------------------ form fields ------------------------------
   Every field carries data-k="<detail key>"; popup.js reads them back with
   readFields(). Inputs are disabled by the surrounding <fieldset> when the
   record is locked. */
export function field(label, k, value, { type = "text", wide = false, placeholder = "", min, max, step } = {}){
  const attrs = [
    `type="${type}"`, `data-k="${k}"`, `value="${esc(value ?? "")}"`,
    placeholder ? `placeholder="${esc(placeholder)}"` : "",
    min !== undefined ? `min="${min}"` : "", max !== undefined ? `max="${max}"` : "",
    step !== undefined ? `step="${step}"` : "",
  ].join(" ");
  return `<label class="iv-f${wide ? " wide" : ""}">${esc(label)}<input ${attrs}></label>`;
}
export function select(label, k, value, options, { wide = false } = {}){
  return `<label class="iv-f${wide ? " wide" : ""}">${esc(label)}<select data-k="${k}">${
    options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(t)}</option>`).join("")
  }</select></label>`;
}
export const block = (title, inner) =>
  `<div class="iv-block"><div class="iv-group-title">${esc(title)}</div>${inner}</div>`;

export function readFields(root){
  const d = {};
  root.querySelectorAll("[data-k]").forEach(el => {
    d[el.dataset.k] = el.type === "checkbox" ? el.checked : el.value.trim();
  });
  return d;
}

/* ------------------------------ line lists -------------------------------
   A repeating list of rows (consultancy roles, hire items, expenses ...).
   cols: [{ k, label, type: "text"|"number"|"money"|"select", options, grow }]
   Rows carry data-list="<name>"; popup.js handles the Add/remove buttons via
   data-add-line / data-remove-line and re-renders the form. */
export function lines(name, rows, cols, { add = "Add line", empty = "" } = {}){
  const head = `<div class="iv-lhead">${cols.map(c => `<span class="${c.grow ? "grow" : ""}">${esc(c.label)}</span>`).join("")}<span></span></div>`;
  const body = (rows || []).map((r, i) => `<div class="iv-line" data-list="${name}" data-i="${i}">${
    cols.map(c => {
      const v = r[c.k] ?? "";
      const cls = c.grow ? "grow" : "";
      if(c.type === "select") return `<select class="${cls}" data-lk="${c.k}" aria-label="${esc(c.label)}">${
        c.options.map(([ov, ot]) => `<option value="${esc(ov)}"${String(ov) === String(v) ? " selected" : ""}>${esc(ot)}</option>`).join("")}</select>`;
      const t = c.type === "text" ? "text" : "number";
      const step = c.type === "money" ? ` step="0.01"` : c.type === "number" ? ` step="any"` : "";
      const mn = c.type === "text" ? "" : ` min="0"`;
      return `<input class="${cls}" type="${t}"${step}${mn} data-lk="${c.k}" value="${esc(v)}" aria-label="${esc(c.label)}"${c.placeholder ? ` placeholder="${esc(c.placeholder)}"` : ""}>`;
    }).join("")
  }<button type="button" class="iv-x ibtn danger" data-remove-line="${name}" data-i="${i}" aria-label="Remove line">&times;</button></div>`).join("");
  const none = !(rows || []).length && empty ? `<p class="iv-empty-line">${esc(empty)}</p>` : "";
  return `<div class="iv-lines" style="--cols:${cols.filter(c => !c.grow).length}">${rows && rows.length ? head : ""}${body}${none}
    <button type="button" class="iv-add" data-add-line="${name}">${esc(add)}</button></div>`;
}
export function readLines(root, name){
  return [...root.querySelectorAll(`.iv-line[data-list="${name}"]`)].map(row => {
    const r = {};
    row.querySelectorAll("[data-lk]").forEach(el => { r[el.dataset.lk] = el.value.trim(); });
    return r;
  });
}

/* ---------------------------- document model -----------------------------
   { title, meta, facts:[[label, value]], lines:[{name, sub, amount}],
     rows:[[label, value]], total:[label, value], note, terms, file }
   meta (from popup.js): { quoteRef, invoiceRef, issued, invoiced } */
export function quoteMeta(meta, validDays){
  const issued = new Date(meta.issued || Date.now());
  const valid = new Date(issued); valid.setDate(valid.getDate() + int(validDays));
  return `${meta.quoteRef || "Not yet numbered"} · Issued ${fmtDate(issued)} · Valid until ${fmtDate(valid)}`;
}
export function invoiceMeta(meta){
  return meta.invoiceRef
    ? `${meta.invoiceRef} · ${fmtDate(meta.invoiced)} · Quote ${meta.quoteRef}`
    : `Preview · an invoice number is assigned when the invoice is generated · Quote ${meta.quoteRef || "-"}`;
}
export const fileName = (ref, kind, title) => `${ref || kind} ${kind} - ${title || "untitled"}`;

// Subtotal / VAT / total rows shared by the totals-based pricing model.
export function totals(sub, vatPct, totalLabel){
  const vat = sub * num(vatPct) / 100;
  return { rows: [["Subtotal", gbp(sub)], [`VAT at ${num(vatPct)}%`, gbp(vat)]], total: [totalLabel, gbp(sub + vat)], grand: sub + vat };
}
