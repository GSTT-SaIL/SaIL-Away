/* The three steps a quote/invoice goes through, and the compact progress
   bar that shows them on every row of the Invoices list - progressHTML().
   (The pop-up shows the same steps as its flow.) On a row, the Quote and
   Invoice steps are buttons that download that PDF once it exists:

     1 Quote generated -> 2 Invoice generated -> 3 Paid

   stored as invoices.status: quoted | invoiced | paid. There are no drafts
   (1735000018): a record is created by generating its quote, so it starts
   at "quoted". Nothing is "cancelled" either - an unwanted quote or invoice
   is deleted. How far along a record is decides what can be edited (see
   popup.js): a generated quote or invoice only after going back to it,
   which is warned.
   Styles: .iv-prog in css/views/invoicer.css; colours --step-* in base.css. */
import { esc } from "../../core/util.js";

export const STEPS = [
  { n: 1, status: "quoted",   label: "Quote generated",   short: "Quote",   colour: "var(--step-quote)" },
  { n: 2, status: "invoiced", label: "Invoice generated", short: "Invoice", colour: "var(--step-invoice)" },
  { n: 3, status: "paid",     label: "Paid",              short: "Paid",    colour: "var(--step-paid)" },
];
// Index = steps done: 0 is a new quote not yet generated (not a status -
// it's never saved), 1 quoted ... 3 paid.
export const ORDER = [null, "quoted", "invoiced", "paid"];
export const stage = status => Math.max(ORDER.indexOf(status), 0);

export const STATUS = {
  quoted: "Quote generated", invoiced: "Invoice generated", paid: "Paid",
};

/* cur:       stage reached (0-3)
   mini:      the compact row version (short labels, no sub-lines)
   step:      (step, { done, next }) => { button, attrs, label, sub, after }
              lets the pop-up make a step a button (button: true, with
              extra attrs), relabel it, add a second line (sub) or append
              markup after its text (after - e.g. an Undo link). Without it,
              every step is a plain span (the rows). */
export function progressHTML(cur, { mini = false, step = null, label = "" } = {}){
  let buttons = false;
  const steps = STEPS.map(st => {
    const done = cur >= st.n;
    const next = cur === st.n - 1;
    const o = step ? (step(st, { done, next }) || {}) : {};
    const cls = `iv-pstep${done ? " done" : ""}${next ? " next" : ""}${o.button ? " cta" : ""}`;
    const inner = `<span class="iv-pdot" aria-hidden="true">${done ? "&#10003;" : st.n}</span>`
      + `<span class="iv-ptext"><span class="iv-plabel">${esc(o.label || (mini ? st.short : st.label))}</span>`
      + `${o.sub ? `<span class="iv-psub">${esc(o.sub)}</span>` : ""}</span>`
      + (o.after || "");
    const line = st.n > 1
      ? `<span class="iv-pline${done ? " done" : ""}" style="--c1:${STEPS[st.n - 2].colour};--c2:${st.colour}" aria-hidden="true"></span>`
      : "";
    const common = `class="${cls}" style="--c:${st.colour}" data-s="${st.status}" data-step="${st.n}"`;
    if(o.button) buttons = true;
    const el = o.button
      ? `<button type="button" ${common} ${o.attrs || ""}>${inner}</button>`
      : `<span ${common}>${inner}</span>`;
    return line + el;
  }).join("");
  return `<span class="iv-prog${mini ? " mini" : ""}"`
    // role="img" hides the steps from screen readers - only when none is a button.
    + `${label && !buttons ? ` role="img" aria-label="${esc(label)}"` : ` role="group" aria-label="${esc(label || "Progress")}"`}>${steps}</span>`;
}
