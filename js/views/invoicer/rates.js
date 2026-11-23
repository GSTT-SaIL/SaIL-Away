/* The price list editor: the one shared price list (price_list record) -
   VAT, how long quotes stay valid, and two lists of known prices:
     per attendee   - per head, per day (full / half day), for events
     per item/hour  - each charged per hour, per day or each
   Opened from the Invoices view in edit mode. Saving updates the list;
   quotes already generated keep the prices they were generated with. */
import { pb } from "../../core/pb.js";
import { esc } from "../../core/util.js";
import { reportSaveError } from "../../core/shell.js";
import { num, newKey } from "./common.js";

const $ = id => document.getElementById(id);
let T = null;   // { rec, attendee, items, onSaved }

const SECTIONS = {
  attendee: {
    title: "Per attendee", note: "Prices per paying attendee, per day.",
    cols: [
      { k: "name", label: "Item", type: "text", grow: true },
      { k: "sub", label: "Description", type: "text", grow: true },
      { k: "full", label: "Full day £", type: "money" },
      { k: "half", label: "Half day £", type: "money" },
    ],
    blank: () => ({ key: newKey(), name: "", sub: "", full: 0, half: 0 }),
  },
  items: {
    title: "Per item or hour", note: "Each charged per hour, per day, or each.",
    cols: [
      { k: "name", label: "Item", type: "text", grow: true },
      { k: "unit", label: "Charged", type: "select", options: [["hour", "Per hour"], ["day", "Per day"], ["each", "Each"]] },
      { k: "price", label: "Price £", type: "money" },
    ],
    blank: () => ({ key: newKey(), name: "", unit: "hour", price: 0 }),
  },
};

function sectionHTML(name){
  const sec = SECTIONS[name];
  const head = `<div class="rt-row rt-head">${sec.cols.map(c => `<span class="${c.grow ? "grow" : c.type}">${esc(c.label)}</span>`).join("")}<span class="x"></span></div>`;
  const rows = T[name].map((it, i) => `<div class="rt-row" data-sec="${name}" data-i="${i}">${sec.cols.map(c => {
    const v = it[c.k];
    if(c.type === "select") return `<select class="select" data-rk="${c.k}" aria-label="${esc(c.label)}">${c.options.map(([ov, ot]) =>
      `<option value="${esc(ov)}"${ov === v ? " selected" : ""}>${esc(ot)}</option>`).join("")}</select>`;
    const t = c.type === "money" ? `type="number" step="0.01" min="0"` : `type="text"`;
    return `<input class="${c.grow ? "grow" : c.type}" ${t} data-rk="${c.k}" value="${esc(v ?? "")}" aria-label="${esc(c.label)}">`;
  }).join("")}<button type="button" class="iv-x ibtn danger" data-rm="${name}:${i}" aria-label="Remove">&times;</button></div>`).join("");
  return `<section class="rt-section"><h3>${esc(sec.title)}</h3><p class="iv-hint">${esc(sec.note)}</p>
    ${T[name].length ? head : ""}${rows}
    <button type="button" class="iv-add" data-rt-add="${name}">Add a price</button></section>`;
}

function readSection(name){
  const sec = SECTIONS[name];
  return [...$("rt-items").querySelectorAll(`.rt-row[data-sec="${name}"]`)].map(row => {
    const it = { ...T[name][Number(row.dataset.i)] };   // keeps each item's key
    sec.cols.forEach(c => {
      const el = row.querySelector(`[data-rk="${c.k}"]`);
      it[c.k] = c.type === "money" ? num(el.value) : el.value.trim();
    });
    return it;
  });
}
const readAll = () => { T.attendee = readSection("attendee"); T.items = readSection("items"); };

function render(){ $("rt-items").innerHTML = sectionHTML("attendee") + sectionHTML("items"); }

export function openRates(rec, onSaved){
  T = { rec, attendee: JSON.parse(JSON.stringify(rec.attendee || [])), items: JSON.parse(JSON.stringify(rec.items || [])), onSaved };
  $("rt-vat").value = rec.vat ?? 20;
  $("rt-valid").value = rec.valid_days ?? 30;
  render();
  $("rates-editor").hidden = false;
  $("rt-vat").focus();
}
export function closeRates(){ if(T){ $("rates-editor").hidden = true; T = null; } }

async function save(){
  readAll();
  try{
    const rec = await pb.collection("price_list").update(T.rec.id, {
      attendee: T.attendee.filter(it => it.name), items: T.items.filter(it => it.name),
      vat: num($("rt-vat").value), valid_days: Math.max(0, parseInt($("rt-valid").value, 10) || 0),
    });
    const done = T.onSaved; closeRates(); done?.(rec);
  }catch(err){ reportSaveError(err); }
}

export function initRates(){
  const el = document.createElement("div");
  el.id = "rates-editor"; el.className = "iv-backdrop rt-backdrop"; el.hidden = true;
  el.innerHTML = `<div class="rt-sheet" role="dialog" aria-modal="true" aria-labelledby="rt-title">
    <h2 id="rt-title">Price list</h2>
    <p class="rt-model">These prices are locked on quotes; anything else can go on a quote as a custom line.</p>
    <div class="rt-basics">
      <label class="iv-f">VAT %<input type="number" id="rt-vat" min="0" max="100" step="0.1"></label>
      <label class="iv-f">Quotes valid for (days)<input type="number" id="rt-valid" min="0" step="1"></label>
    </div>
    <div id="rt-items"></div>
    <p class="iv-hint">Quotes already generated keep the prices they were generated with.</p>
    <div class="rt-actions">
      <button type="button" class="sbtn link" data-rt="cancel">Cancel</button>
      <button type="button" class="sbtn primary" data-rt="save">Save prices</button>
    </div>
  </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => {
    if(!T) return;
    if(e.target === el || e.target.closest('[data-rt="cancel"]')) return closeRates();
    if(e.target.closest('[data-rt="save"]')) return save();
    const add = e.target.closest("[data-rt-add]");
    if(add){ readAll(); T[add.dataset.rtAdd].push(SECTIONS[add.dataset.rtAdd].blank()); render(); return; }
    const rm = e.target.closest("[data-rm]");
    if(rm){ readAll(); const [sec, i] = rm.dataset.rm.split(":"); T[sec] = T[sec].filter((_, j) => j !== Number(i)); render(); }
  });
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && T){ e.stopPropagation(); closeRates(); }
  }, true);
}
