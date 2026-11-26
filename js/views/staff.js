/* Staff view (#pane-staff, the user's design 2026-10-09): each person's
   leave in the financial year on show. The shared grouped list (.glist),
   without sub-items: one group per person (their name, in their site's
   colour; in All with a site pill too - view-only there), one row per
   allocation - its kind (WFH / Annual leave / Sick) as the title, then a
   short note (popped out in full on hover when cut short), its dates and
   how long.

   People are the site's accounts with that home site (users.home_site, set
   in the dashboard), read through the `staff` view - names only, never
   emails. Allocations are whole days over a date range, or hours on a
   single day. Everyone on the site sees them; only admins change them
   (pb_migrations/1735000026_staff.js; pb_hooks/leave.pb.js checks the
   dates and hours whatever the board does). */
import { pb } from "../core/pb.js";
import { CHEV, esc, shortDate, parseISO } from "../core/util.js";
import { ui, updateCount, reportSaveError } from "../core/shell.js";
import { period, inPeriod, defaultISO, outsideMessage } from "../core/period.js";
import { siteFilter, andSite, isAll, siteById, siteColour, siteTint, siteOrder } from "../core/site.js";
import { ask, tell } from "../core/dialog.js";
import { lineUp } from "../core/rowdetails.js";

const ID = "pane-staff";
const $ = id => document.getElementById(id);
const KINDS = [["annual", "Annual leave"], ["wfh", "WFH"], ["sick", "Sick"]];
const KIND = Object.fromEntries(KINDS);

const PEOPLE = [], LEAVE = [];
const openGroups = new Set();   // collapsed by default, like every board
let loaded = false, loading = null, gen = 0, countText = "";

const isAdmin = () => pb.authStore.record?.role === "admin";
const editable = () => ui.editing && isAdmin();
const leaveOf = id => LEAVE.filter(l => l.person === id).sort((a, b) => a.start.localeCompare(b.start) || (a.from || "").localeCompare(b.from || ""));
const days = l => Math.round((parseISO(l.end) - parseISO(l.start)) / 86400000) + 1;
const when = l => l.start === l.end ? shortDate(l.start) : `${shortDate(l.start)} &ndash; ${shortDate(l.end)}`;
const howLong = l => l.from ? `${esc(l.from)}&ndash;${esc(l.to)}` : `${days(l)} day${days(l) === 1 ? "" : "s"}`;

/* -------------------------------- data ---------------------------------- */
async function load(){
  if(loading) return loading;
  const g = gen;
  loading = (async () => {
    $("staff-rows").innerHTML = `<div class="empty">Loading&hellip;</div>`;
    try{
      const [people, leave] = await Promise.all([
        pb.collection("staff").getFullList({ sort: "name", filter: siteFilter(), requestKey: null }),
        // Anything overlapping the year on show.
        pb.collection("leave").getFullList({ requestKey: null,
          filter: andSite(pb.filter("start <= {:end} && end >= {:start}", { start: period.start, end: period.end })) }),
      ]);
      if(g !== gen) return;
      // In All: only the sites that have a Staff page, site by site.
      const shown = isAll() ? people.filter(p => siteById(p.site)?.views?.includes("staff")) : people;
      shown.sort((a, b) => siteOrder(a.site) - siteOrder(b.site) || a.name.localeCompare(b.name));
      PEOPLE.splice(0, PEOPLE.length, ...shown.map(p => ({ id: p.id, name: p.name, site: p.site })));
      LEAVE.splice(0, LEAVE.length, ...leave.map(pick));
      loaded = true;
      render(); updateCount();
    }catch(err){
      if(g !== gen) return;
      console.error(err);
      $("staff-rows").innerHTML = `<div class="empty">Could not load staff (${esc(err.message || err)}).</div>`;
    }finally{ loading = null; }
  })();
  return loading;
}
const pick = r => ({ id: r.id, person: r.person, kind: r.kind, start: r.start, end: r.end, from: r.from || "", to: r.to || "", note: r.note || "" });

/* ------------------------------- the list ------------------------------- */
function render(){
  if(!loaded){ countText = ""; return; }
  const q = ui.q, filtering = !!q, editing = editable();
  let html = "", shownPeople = 0, shownLeave = 0;

  PEOPLE.forEach(p => {
    const nameHit = !filtering || p.name.toLowerCase().includes(q);
    const all = leaveOf(p.id);
    const rows = nameHit ? all : all.filter(l => KIND[l.kind].toLowerCase().includes(q) || l.note.toLowerCase().includes(q));
    if(filtering && !nameHit && !rows.length) return;
    shownPeople++; shownLeave += rows.length;
    const open = filtering || openGroups.has(p.id);

    // Each person's header in their site's colour (the user's call,
    // 2026-10-09 - it was plain grey); in All with the site's pill too,
    // like All's Courses.
    const st = siteById(p.site);
    const ink = siteColour(st), tint = siteTint(st);
    const tag = isAll() ? `<span class="sitetag" style="--site:${esc(ink)}">${esc(st?.name || "")}</span>` : "";
    html += `<section class="gsec"><div class="grouphead" data-group="${p.id}" aria-expanded="${open}"
      style="--gink:${esc(ink)};--gtint:${esc(tint)}">
      <div class="gname">${CHEV}${tag}${esc(p.name)}
        <span class="gcount">${rows.length} ${rows.length === 1 ? "entry" : "entries"}</span></div></div>`;
    if(!open){ html += `</section>`; return; }
    html += `<div class="gcard">`;
    if(!rows.length && !editing) html += `<div class="row item leave"><div class="name muted">No leave in ${esc(period.label)}</div></div>`;
    rows.forEach(l => {
      html += editing ? editRow(l) : `<div class="row item leave lined">
        <div class="name"><span class="ititle">${esc(KIND[l.kind] || l.kind)}</span></div>
        <div class="rdata" data-kind="leave">
          <span class="rd note">${l.note ? `<span class="ntext">${esc(l.note)}</span>` : ""}</span>
          <span class="rd">${when(l)}</span>
          <span class="rd calc">${howLong(l)}</span>
        </div>
      </div>`;
    });
    if(editing && !filtering) html += `<div class="addrow additem" data-add-leave="${p.id}">Add leave</div>`;
    html += `</div></section>`;
  });

  $("staff-rows").innerHTML = html || (filtering
    ? `<div class="empty">Nothing matches that filter. Try a name or a kind of leave.</div>`
    : `<div class="empty">No staff on this site yet. Give people a home site on the Admin page.</div>`);
  countText = `${shownPeople} ${shownPeople === 1 ? "person" : "people"}, ${shownLeave} ${shownLeave === 1 ? "entry" : "entries"}`;
  lineUp($("staff-rows"));
}

// Edit mode: kind, from, to, and "Hours" - ticked, the hours replace the
// end date (one day only, the user's rule).
function editRow(l){
  const hours = !!l.from;
  const d = (f, v, extra = "") => `<input class="ed" type="date" value="${esc(v)}" min="${period.start}" max="${period.end}" data-lid="${l.id}" data-f="${f}"${extra}>`;
  const t = (f, v) => `<input class="ed" type="time" value="${esc(v)}" data-lid="${l.id}" data-f="${f}">`;
  return `<div class="row item leave">
    <div class="name"><select class="ed" data-lid="${l.id}" data-f="kind">${
      KINDS.map(([v, n]) => `<option value="${v}"${v === l.kind ? " selected" : ""}>${n}</option>`).join("")}</select></div>
    <div><input class="ed" value="${esc(l.note)}" maxlength="500" placeholder="Note" data-lid="${l.id}" data-f="note"></div>
    <div>${d("start", l.start)}</div>
    <div>${hours ? `<span class="muted oneday">Same day</span>` : d("end", l.end)}</div>
    <div class="hours"><label class="hcheck"><input type="checkbox" data-lid="${l.id}" data-f="hours"${hours ? " checked" : ""}> Hours</label>
      ${hours ? `<span class="pair">${t("from", l.from)}${t("to", l.to)}</span>` : ""}</div>
    <button class="del ibtn danger" data-del-leave="${l.id}" title="Delete leave">&times;</button>
  </div>`;
}

/* ------------------------------ editing --------------------------------- */
async function save(l, patch){
  const before = { ...l };
  Object.assign(l, patch);
  render();
  try{ Object.assign(l, pick(await pb.collection("leave").update(l.id, patch))); }
  catch(err){ Object.assign(l, before); render(); reportSaveError(err); }
}

function onChange(e){
  const el = e.target.closest("[data-f]");
  if(!el) return;
  const l = LEAVE.find(x => x.id === el.dataset.lid);
  if(!l) return;
  const f = el.dataset.f;
  if(f === "kind") return save(l, { kind: el.value });
  if(f === "note") return save(l, { note: el.value.trim() });
  if(f === "hours") return save(l, el.checked
    ? { end: l.start, from: "09:00", to: "13:00" }      // a single day, morning by default
    : { from: "", to: "" });
  if(el.type === "date"){
    // Inside the year on show only (the board's rule); the picker can't
    // go outside it, a typed date is put back.
    if(!el.value || !inPeriod(el.value)){ const typed = el.value; el.value = l[f]; if(typed) tell(outsideMessage(typed)); return; }
    if(f === "start") return save(l, l.from || el.value > l.end ? { start: el.value, end: el.value } : { start: el.value });
    if(el.value < l.start){ el.value = l.end; tell("The leave can't end before it starts."); return; }
    return save(l, { end: el.value });
  }
  if(el.type === "time"){
    const from = f === "from" ? el.value : l.from, to = f === "to" ? el.value : l.to;
    if(!from || !to || to <= from){ el.value = l[f]; tell("The hours must end after they start."); return; }
    return save(l, { [f]: el.value });
  }
}

async function onClick(e){
  if(e.target.closest("input,select,label")) return;

  const add = e.target.closest("[data-add-leave]");
  if(add){
    const day = defaultISO();
    try{
      const p = PEOPLE.find(x => x.id === add.dataset.addLeave);
      // Their home site (the server sets it anyway - pb_hooks/leave.pb.js).
      const rec = await pb.collection("leave").create({ person: p.id, site: p.site, kind: "annual", start: day, end: day, from: "", to: "" });
      LEAVE.push(pick(rec));
      render(); updateCount();
    }catch(err){ reportSaveError(err); }
    return;
  }

  const del = e.target.closest("[data-del-leave]");
  if(del){
    const l = LEAVE.find(x => x.id === del.dataset.delLeave);
    if(!l || !await ask(`Delete this ${KIND[l.kind] || "leave"} (${when(l).replace("&ndash;", "to")})?`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection("leave").delete(l.id); }catch(err){ reportSaveError(err); return; }
    LEAVE.splice(LEAVE.indexOf(l), 1);
    render(); updateCount();
    return;
  }

  const g = e.target.closest("[data-group]");
  if(g){
    const id = g.dataset.group;
    openGroups.has(id) ? openGroups.delete(id) : openGroups.add(id);
    syncToggleLabel(); render();
  }
}

/* A note too long for its cell pops out in full on hover (the user's
   call). One bubble on the page, placed over the cell - a bubble inside
   the row would be clipped by the details' sideways scroller. */
let pop = null;
function showNote(e){
  const t = e.target.closest?.(".ntext");
  if(!t || t.scrollWidth <= t.clientWidth) return;
  pop ||= Object.assign(document.createElement("div"), { className: "notepop", role: "tooltip" });
  if(!pop.isConnected) document.body.append(pop);
  pop.textContent = t.textContent;
  const r = t.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left - 12, innerWidth - 340)) + "px";
  pop.style.top = (r.top - 9) + "px";
  pop.hidden = false;
}
const hideNote = e => { if(pop && !e.relatedTarget?.closest?.(".notepop")) pop.hidden = true; };

const syncToggleLabel = () => { $("collapse-all").textContent = openGroups.size ? "Collapse all" : "Expand all"; };

function forget(){
  gen++; loaded = false; loading = null; countText = "";
  PEOPLE.length = 0; LEAVE.length = 0;
}

export default {
  id: ID,
  label: "Staff",
  toolbar: { filter: "Filter people, leave", expandAll: true },
  init(){
    const pane = $(ID);
    pane.addEventListener("click", onClick);
    pane.addEventListener("change", onChange);
    pane.addEventListener("mouseover", showNote);
    pane.addEventListener("mouseout", e => { if(e.target.closest?.(".ntext")) hideNote(e); });
    pane.addEventListener("scroll", () => { if(pop) pop.hidden = true; }, true);
  },
  render,
  async show(){
    syncToggleLabel();
    if(!loaded) await load();
  },
  count: () => countText,
  toggleAll(){
    if(openGroups.size) openGroups.clear();
    else PEOPLE.forEach(p => openGroups.add(p.id));
    syncToggleLabel(); render();
  },
  // Another year or site: drop what's loaded; the next show() loads afresh.
  periodChanged(){ forget(); },
  siteChanged(){ forget(); openGroups.clear(); syncToggleLabel(); },
  reset(){ forget(); openGroups.clear(); $("staff-rows").innerHTML = ""; if(pop) pop.hidden = true; },
};
