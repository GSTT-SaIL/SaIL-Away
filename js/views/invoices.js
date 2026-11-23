/* Invoices view (#pane-invoices): quotes and invoices, grouped by invoice
   type the way Courses groups courses - one row per quote/invoice, no
   sub-rows. Clicking a row opens the invoicer pop-up (invoicer/popup.js)
   for it; "New quote" under each group opens a blank one - nothing is saved
   until its quote is generated (there are no drafts).

   Everyone signed in can see it; only admins can change anything - add
   quotes, move them along, edit types or prices (the collections' API rules
   enforce that; viewers simply aren't offered it). Invoice types are just
   categories - name and colour; how each quote is
   priced is chosen inside the pop-up. In edit mode admins can also add
   quotes, rename and recolour types, add or remove empty types, and edit
   the shared price list (invoicer/rates.js).

   Its data isn't shared with other views, so it loads its own, the first
   time it's shown, rather than going through core/data.js - and only the
   financial year on show (core/period.js): a quote or invoice belongs to the
   year of its own date, or, with no date yet, the year it was created in. */
import { pb } from "../core/pb.js";
import { canEdit as mayEdit, siteId, siteFilter, andSite } from "../core/site.js";
import { esc, CHEV, shortDate, debounceSave } from "../core/util.js";
import { PALETTE } from "../core/data.js";
import { ui, updateCount, reportSaveError } from "../core/shell.js";
import { period, inPeriod, periodStamps, defaultISO } from "../core/period.js";
import { gbp } from "./invoicer/common.js";
import { open as openInvoicer, close as closeInvoicer, init as initInvoicer, downloadDoc } from "./invoicer/popup.js";
import { STATUS, stage, progressHTML } from "./invoicer/stages.js";
import { openRates, closeRates, initRates } from "./invoicer/rates.js";
import { ask } from "../core/dialog.js";
import { lineUp } from "../core/rowdetails.js";

const ID = "pane-invoices";
const $ = id => document.getElementById(id);

const TYPES = [];
const INVOICES = [];
let PRICES = null;            // the price_list record (one, shared)
const open = new Set();       // expanded groups (collapsed by default)
// gen bumps on sign-out, so a load still in flight then drops its result
// instead of showing the previous user's invoices to the next one.
let loaded = false, loading = null, countText = "", gen = 0;

// The list only shows what was actually paid; quoted and invoiced figures
// are in the pop-up.
const amountOf = r => r.status === "paid" ? gbp(r.invoice_total) : "";
// The same progress bar as the pop-up, in its compact read-only form.
// Its Quote and Invoice steps download that PDF, once there is one - every
// record has its quote (no drafts), an invoice once it's invoiced.
const hasDoc = (r, kind) => kind === "quote" || r.status === "invoiced" || r.status === "paid";
const indicators = r => `<span class="prog-cell">${progressHTML(stage(r.status), {
  mini: true, label: STATUS[r.status],
  step: st => {
    const kind = st.status === "quoted" ? "quote" : st.status === "invoiced" ? "invoice" : null;
    if(!kind || !hasDoc(r, kind)) return null;
    const ref = kind === "quote" ? r.quote_ref : r.invoice_ref;
    return { button: true, attrs: `data-pdf="${kind}" title="Download ${esc(ref)} (PDF)" aria-label="Download ${esc(ref)} as a PDF"` };
  },
})}</span>`;
const rowText = r => [r.quote_ref, r.invoice_ref, r.title, r.client, STATUS[r.status]].join(" ").toLowerCase();

// Which financial year a record belongs to - the same rule as the load
// filter below, for records changed since loading.
const inYear = r => r.date ? inPeriod(r.date) : inPeriod((r.created || "").slice(0, 10));
const yearFilter = () => {
  const { from, to } = periodStamps();
  return pb.filter("(date >= {:s} && date <= {:e}) || (date = '' && created >= {:from} && created <= {:to})",
    { s: period.start, e: period.end, from, to });
};

/* -------------------------------- data ---------------------------------- */
async function load(){
  if(loading) return loading;
  const g = gen;
  loading = (async () => {
    $("inv-rows").innerHTML = `<div class="empty">Loading&hellip;</div>`;
    try{
      const [types, invoices, prices] = await Promise.all([
        // The site on show (core/site.js): its types, its year's quotes and
        // invoices, its price list.
        pb.collection("invoice_types").getFullList({ sort: "sort", filter: siteFilter() }),
        pb.collection("invoices").getFullList({ sort: "-created", filter: andSite(yearFilter()) }),
        pb.collection("price_list").getFullList({ filter: siteFilter() }),
      ]);
      if(g !== gen) return;
      PRICES = prices[0] || { attendee: [], items: [], vat: 20, valid_days: 30 };
      TYPES.splice(0, TYPES.length, ...types);
      INVOICES.splice(0, INVOICES.length, ...invoices);
      loaded = true;
      render();
    }catch(err){
      if(g !== gen) return;
      console.error(err);
      $("inv-rows").innerHTML = `<div class="empty">Could not load invoices (${esc(err.message || err)}).</div>`;
    }finally{ loading = null; }
  })();
  return loading;
}

// Called by the pop-up after a save, status change or delete.
function changed(rec, deletedId){
  if(deletedId){
    const i = INVOICES.findIndex(r => r.id === deletedId);
    if(i !== -1) INVOICES.splice(i, 1);
  } else if(rec){
    const i = INVOICES.findIndex(r => r.id === rec.id);
    if(i === -1) INVOICES.unshift(rec); else INVOICES[i] = rec;
  }
  render();
}

/* ------------------------------- render --------------------------------- */
function render(){
  if(!loaded){ countText = ""; return; }
  const q = ui.q, editing = ui.editing;
  let html = "", shown = 0;

  const yearRows = INVOICES.filter(inYear);
  TYPES.forEach(t => {
    const all = yearRows.filter(r => r.type === t.id);
    const rows = q ? all.filter(r => rowText(r).includes(q)) : all;
    if(q && !rows.length) return;
    shown += rows.length;
    const isOpen = q || open.has(t.id);

    // Header filled with the type's tint, name in its ink (css: .glist in
    // base.css - the same look as the Courses groups).
    html += `<section class="gsec"><div class="grouphead" data-type="${t.id}" aria-expanded="${!!isOpen}"
      style="--gink:${esc(t.ink)};--gtint:${esc(t.tint)}">
      <div class="gname">${CHEV}${editing
        ? `<input class="ed gtitle" value="${esc(t.name)}" data-tid="${t.id}" data-tfield="name" aria-label="Type name">
           <select class="ed gcol" data-tid="${t.id}" data-tfield="colour" aria-label="Colour">${
             PALETTE.map(p => `<option value="${p.ink}"${p.ink === t.ink ? " selected" : ""}>${p.name}</option>`).join("")}</select>
`
        : esc(t.name)}
        <span class="gcount">${rows.length} ${rows.length === 1 ? "line" : "lines"}</span>
      </div>
      ${editing && !all.length && TYPES.length > 1 ? `<button class="delg ibtn danger" data-deltype="${t.id}" title="Delete this type">&times;</button>` : ""}
    </div>`;
    if(!isOpen){ html += `</section>`; return; }

    // Admins get a "New quote" row at the foot of each group, styled as one
    // more (empty) row; viewers see the rows only.
    // Same row as a quote; the label sits under the refs, on the left.
    const addRow = mayEdit() && !q ? `<div class="irow irow-add" data-new-inv="${t.id}" tabindex="0" role="button" aria-label="New quote in ${esc(t.name)}">
        <span class="add-label"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>New quote</span></div>` : "";
    if(!rows.length && !addRow){ html += `<div class="gcard"><div class="gempty">No quotes yet.</div></div></section>`; return; }
    // Ref and title locked on the left; the progress bar, client, date and
    // amount are the row's details (css .lined/.rdata, js/core/rowdetails.js).
    html += `<div class="gcard">` + rows.map(r => `<div class="irow lined st-${r.status}" data-open-inv="${r.id}" tabindex="0" role="button"
        aria-label="${esc((r.title || "Untitled") + ", " + STATUS[r.status])}">
        <span class="ref">${esc(r.invoice_ref || r.quote_ref)}</span>
        <span class="ttl">${esc(r.title || "Untitled")}</span>
        <div class="rdata" data-kind="invoice">${indicators(r)}
          <span class="rd">${esc(r.client || "-")}</span>
          <span class="rd">${r.date ? esc(shortDate(r.date)) : "-"}</span>
          <span class="rd amt">${esc(amountOf(r)) || "&nbsp;"}</span>
        </div>
      </div>`).join("")
      + addRow
      + `</div></section>`;
  });

  if(editing && !q) html += `<div class="inv-editbar"><div class="addrow addgroup" data-add-type>Add invoice type</div>
    <div class="addrow addgroup" data-prices>Edit price list</div></div>`;
  $("inv-rows").innerHTML = html || `<div class="empty">${q ? "Nothing matches that filter. Try a ref, title or client." : "No invoice types yet."}</div>`;
  countText = q ? `${shown} of ${yearRows.length} quotes and invoices` : `${yearRows.length} quotes and invoices`;
  lineUp($("inv-rows"));
}

/* ------------------------------ type edits ------------------------------ */
async function updateType(id, patch){
  try{
    const rec = await pb.collection("invoice_types").update(id, patch);
    const i = TYPES.findIndex(t => t.id === id);
    if(i !== -1) TYPES[i] = rec;
  }catch(err){ reportSaveError(err); await load(); }
}

function onInput(e){
  const el = e.target.closest('[data-tfield="name"]');
  if(!el) return;
  const t = TYPES.find(x => x.id === el.dataset.tid);
  if(!t) return;
  t.name = el.value;
  debounceSave("invoice_types:" + t.id + ":name", () => updateType(t.id, { name: t.name }));
}

async function onChange(e){
  const el = e.target.closest("[data-tfield]");
  if(!el || el.tagName !== "SELECT") return;
  const t = TYPES.find(x => x.id === el.dataset.tid);
  if(!t) return;
  if(el.dataset.tfield === "colour"){
    const p = PALETTE.find(p => p.ink === el.value);
    if(p){ t.ink = p.ink; t.tint = p.tint; render(); await updateType(t.id, { ink: p.ink, tint: p.tint }); }
  }
}

async function onClick(e){
  if(e.target.closest("input,select")) return;

  if(e.target.closest("[data-prices]")){
    if(PRICES) openRates(PRICES, rec => { PRICES = rec; });
    return;
  }
  const del = e.target.closest("[data-deltype]");
  if(del){
    const t = TYPES.find(x => x.id === del.dataset.deltype);
    if(!t || !await ask(`Delete the invoice type "${t.name}"?`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection("invoice_types").delete(t.id); }catch(err){ reportSaveError(err); return; }
    TYPES.splice(TYPES.indexOf(t), 1);
    render(); updateCount();
    return;
  }
  if(e.target.closest("[data-add-type]")){
    const used = new Set(TYPES.map(t => t.ink));
    const p = PALETTE.find(p => !used.has(p.ink)) || PALETTE[0];
    try{
      // Filed under the site on show; its quotes take its site on the server.
      const rec = await pb.collection("invoice_types").create({
        site: siteId(), name: "New type", ink: p.ink, tint: p.tint, sort: TYPES.length,
      });
      TYPES.push(rec); open.add(rec.id); render();
    }catch(err){ reportSaveError(err); }
    return;
  }
  const pdf = e.target.closest("[data-pdf]");
  if(pdf){
    const r = INVOICES.find(x => x.id === pdf.closest("[data-open-inv]")?.dataset.openInv);
    if(r) downloadDoc(r, pdf.dataset.pdf);
    return;
  }
  const row = e.target.closest("[data-open-inv]");
  if(row){
    const r = INVOICES.find(x => x.id === row.dataset.openInv);
    const t = r && TYPES.find(x => x.id === r.type);
    if(r && t) openInvoicer(r, t, PRICES, (rec, id) => { changed(rec, id); updateCount(); });
    return;
  }
  const nw = e.target.closest("[data-new-inv]");
  if(nw){
    const t = TYPES.find(x => x.id === nw.dataset.newInv);
    // Dated inside the year on show, so it's filed (and stays visible) there.
    if(t) openInvoicer(null, t, PRICES, (rec, id) => { changed(rec, id); updateCount(); }, { date: defaultISO() });
    return;
  }
  const g = e.target.closest("[data-type]");
  if(g){
    const id = g.dataset.type;
    open.has(id) ? open.delete(id) : open.add(id);
    syncToggleLabel(); render();
  }
}

const syncToggleLabel = () => {
  $("collapse-all").textContent = open.size ? "Collapse all" : "Expand all";
};

export default {
  id: ID,
  label: "Invoices",
  toolbar: { filter: "Filter invoices, clients, refs", expandAll: true },
  init(){
    const pane = $(ID);
    pane.addEventListener("click", onClick);
    pane.addEventListener("input", onInput);
    pane.addEventListener("change", onChange);
    pane.addEventListener("keydown", e => {
      if((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open-inv], [data-new-inv]")){ e.preventDefault(); e.target.click(); }
    });
    initInvoicer();
    initRates();
  },
  async show(){
    syncToggleLabel();
    if(!loaded){ await load(); updateCount(); }
  },
  // Another year: drop this one's rows; the next show() loads the new year.
  periodChanged(){
    gen++;
    closeInvoicer(true);
    INVOICES.length = 0;
    loaded = false; loading = null; countText = "";
  },
  // Another site: drop everything of the old one's - its types and prices
  // too; the next show() loads the new site's.
  siteChanged(){
    gen++;
    closeInvoicer(true); closeRates();
    TYPES.length = 0; INVOICES.length = 0; PRICES = null; open.clear();
    loaded = false; loading = null; countText = "";
    $("inv-rows").innerHTML = "";
  },
  render,
  count: () => countText,
  toggleAll(){
    if(open.size) open.clear(); else TYPES.forEach(t => open.add(t.id));
    syncToggleLabel(); render();
  },
  reset(){
    gen++;
    closeInvoicer(true); closeRates();
    TYPES.length = 0; INVOICES.length = 0; PRICES = null; open.clear();
    loaded = false; loading = null; countText = "";
    $("inv-rows").innerHTML = "";
  },
};
