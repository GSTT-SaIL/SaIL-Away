/* Tickets view (#pane-tickets): Eventbrite sign-ups, read-only - a
   full-page month calendar drawn like the Timetable. Clicking an event opens
   the shared item pop-up (views/sheet.js openItem) with a Details tab and an
   Attendees tab; attendees load the first time that tab is opened.

   All data comes through pocketbase/pb_hooks/eventbrite.pb.js, which holds
   the API token server-side and requires a signed-in user - the token never
   reaches the browser, and Eventbrite sends no CORS headers anyway.

   Loaded lazily the first time the view is shown: most visits never open
   it, and the events call is a live round-trip to Eventbrite. */
import { pb } from "../core/pb.js";
import { DOW, MON, TODAY, esc, toISO, addDays, mondayOf, longDate, parseISO } from "../core/util.js";
import { period, inPeriod, todayInPeriod, defaultISO } from "../core/period.js";
import { openItem } from "./sheet.js";
import { makeStrip } from "../core/strip.js";
import { siteId, canEdit } from "../core/site.js";
import { openCreateEvent } from "./eventbrite/create.js";

const $ = id => document.getElementById(id);

// gen bumps on sign-out, so a request still in flight then can tell its
// response belongs to the previous user and drop it rather than render it.
const TK = { events:[], byDate:new Map(), attendees:new Map(), cursor:null, loaded:false, busy:false, gen:0 };

const tkDayKey = iso => (iso||"").slice(0,10);
const tkHHMM   = iso => (iso||"").slice(11,16);
const tkErr = err =>
  (err && err.response && err.response.error) || (err && err.message) || String(err);

// 0deg (empty, red) through amber to 140deg (full, green).
function tkHue(signedUp, capacity){
  if(signedUp==null || !capacity) return null;
  return Math.round(Math.min(signedUp/capacity,1)*140);
}
const tkCount = ev => ev.signedUp==null ? "" : ev.capacity ? `${ev.signedUp} / ${ev.capacity}` : `${ev.signedUp}`;

function status(msg){ $("tk-status").textContent = msg || ""; }

// The month calendar stays inside the financial year on show: April to
// March. Events are bucketed by day (TK.byDate) for every year; only days
// in the year are looked up, so nothing outside it is drawn.
const monthOf = iso => { const d = parseISO(iso); return new Date(d.getFullYear(), d.getMonth(), 1); };
const eventsInYear = () => TK.events.filter(ev=>inPeriod(tkDayKey(ev.start)));
// Where to open: the month of the year's next event, else today's month
// (or the year's nearest end, when today is outside it).
function startMonth(){
  const today = toISO(TODAY);
  const evs = eventsInYear();
  const next = evs.find(ev=>tkDayKey(ev.start) >= today) || evs[0];
  return monthOf(next ? tkDayKey(next.start) : defaultISO());
}
function yearStatus(){
  if(!TK.loaded) return;
  // Eventbrite only gives upcoming live events, so a past year is empty.
  status(eventsInYear().length ? "" : `No upcoming Eventbrite events in ${period.label}.`);
}

// ---------- the calendar ----------
// The financial year as twelve month pages side by side, April to March
// (core/strip.js, the user's design 2026-10-07: scroll sideways). Each
// page is the month's six weeks, from the week holding the 1st, filling
// the view - the same size every month - with the days around the month
// dimmed. Drag, swipe or scroll between months freely; the arrows and
// Today glide to a whole month and lock there.
let MONTHS = [], strip = null;
const ym = d => d.getFullYear() + "-" + d.getMonth();
const addMonths = (m, n) => new Date(m.getFullYear(), m.getMonth() + n, 1);
const monthIndex = m => Math.min(Math.max(
  (m.getFullYear() - MONTHS[0].getFullYear()) * 12 + m.getMonth() - MONTHS[0].getMonth(), 0), MONTHS.length - 1);
const pageWidth = () => $("tk-grid").querySelector(".tkcal")?.getBoundingClientRect().width || 0;
const tkStrip = () => strip ||= makeStrip({
  wrap: $("tk-grid").parentElement, axis: "x", unit: pageWidth, onMove: moved,
});

function moved(i){
  if(!MONTHS.length) return;
  i = Math.min(Math.max(i, 0), MONTHS.length - 1);
  const m = TK.cursor = MONTHS[i];
  $("tk-month").textContent = MON[m.getMonth()] + " " + m.getFullYear();
  $("tk-prev").disabled = i <= 0;
  $("tk-next").disabled = i >= MONTHS.length - 1;
  $("tk-today").disabled = !todayInPeriod();
  $("tk-today").title = todayInPeriod() ? "" : `Today is outside ${period.label}`;
}

// One month page: a day-name row (one sticky element - never one per day),
// then six whole weeks from the week holding the 1st.
function page(m){
  const first = mondayOf(m), todayKey = toISO(TODAY);
  let html = `<div class="tkcal" data-m="${ym(m)}"><div class="hrow">${
    DOW.map((d,i)=>`<div class="h${i>4?" we":""}"><span class="dow">${d.slice(0,3)}</span></div>`).join("")}</div>`;
  for(let i=0;i<42;i++){
    const day = addDays(first, i);
    const key = toISO(day);
    const evs = inPeriod(key) ? (TK.byDate.get(key) || []) : [];
    html += `<div class="cell${day.getMonth()!==m.getMonth()?" out":""}${key===todayKey?" today":""}${i%7>4?" we":""}">
      <span class="dnum">${day.getDate()}${day.getDate()===1?" "+MON[day.getMonth()].slice(0,3):""}</span>
      ${evs.map(ev=>{
        const h = tkHue(ev.signedUp, ev.capacity);
        return `<button type="button" class="tkev${h==null?" unrated":""}" data-ev="${esc(ev.id)}" style="--h:${h??0}"
          title="${esc(ev.name)}, ${esc(tkHHMM(ev.start))}${ev.signedUp!=null?" · "+esc(tkCount(ev))+" signed up":""}">
          <span class="bt">${esc(ev.name)}</span>
          <span class="bm">${esc(tkHHMM(ev.start))}${ev.end?"–"+esc(tkHHMM(ev.end)):""}${
            ev.signedUp!=null?` · ${esc(tkCount(ev))}`:""}</span>
        </button>`;
      }).join("")}
    </div>`;
  }
  return html + `</div>`;
}

function renderYear(){
  MONTHS = Array.from({ length: 12 }, (_, i) => addMonths(monthOf(period.start), i));
  $("tk-grid").innerHTML = MONTHS.map(page).join("");
}

// Draw the year and go (instantly) to a month, locked.
function showMonth(m){
  renderYear();
  tkStrip().go(monthIndex(m), { smooth: false });
}

// ---------- the pop-up ----------

function openEvent(id){
  const ev = TK.events.find(e=>e.id===id);
  if(!ev) return;
  const h = tkHue(ev.signedUp, ev.capacity);
  const day = tkDayKey(ev.start);
  const details = [
    ["Date", esc(day ? longDate(parseISO(day)) : "Not set")],
    ["Time", `<span class="tnum">${esc(tkHHMM(ev.start))}${ev.end ? " to "+esc(tkHHMM(ev.end)) : ""}</span>`],
    ["Venue", esc(ev.venue || (ev.online ? "Online" : "Not set"))],
  ];
  // The count in the event's sign-up colour, as on the calendar, with a bar
  // showing how full it is (no bar without a capacity to measure against).
  if(ev.signedUp!=null){
    const pct = ev.capacity ? Math.round(ev.signedUp/ev.capacity*100) : null;
    details.push(["Signed up", `<span class="tkfill${h==null?" unrated":""}" style="--h:${h??0}">
      <span class="tkfillcount">${esc(ev.capacity ? `${ev.signedUp} of ${ev.capacity}` : String(ev.signedUp))}</span>${
      pct==null ? "" : `<span class="tkfillbar"><i style="width:${Math.min(pct,100)}%"></i></span>
      <span class="tkfillpct">${pct}%</span>`}</span>`]);
  }

  openItem({
    pill: ev.signedUp==null ? { text:"Eventbrite", bg:"var(--group)", fg:"var(--fg-2)" }
      : { text: tkCount(ev)+" signed up", bg:`hsl(${h??0} 72% 88%)`, fg: h==null ? "var(--fg-2)" : `hsl(${h} 85% 23%)` },
    title: ev.name,
    sub: ev.venue || (ev.online ? "Online event" : "Eventbrite event"),
    details,
    action: /^https:\/\//.test(ev.url||"") ? { label:"Open in Eventbrite", href:ev.url, external:true } : null,
    tabs: ["details", "attendees"],
    counts: { attendees: ev.signedUp ?? "" },
    fill: { attendees: (body, isCurrent) => loadAttendees(ev, body, isCurrent) },
  });
}

async function loadAttendees(ev, body, isCurrent){
  const gen = TK.gen;
  if(TK.attendees.has(ev.id)){ body.innerHTML = attendeesHTML(TK.attendees.get(ev.id)); return; }
  body.innerHTML = `<p class="tknote loading" role="status"><span class="spinner"></span>Loading attendees from Eventbrite&hellip;</p>`;
  try{
    const res = await pb.send(`/api/eventbrite/events/${encodeURIComponent(ev.id)}/attendees`, { query: { site: siteId() } });
    if(gen !== TK.gen) return;
    TK.attendees.set(ev.id, res.attendees || []);
    if(isCurrent()) body.innerHTML = attendeesHTML(res.attendees || []);
  }catch(err){
    if(gen !== TK.gen || !isCurrent()) return;
    body.innerHTML = `<p class="tknote">Could not load attendees (${esc(tkErr(err))}).</p>`;
  }
}

function attendeesHTML(list){
  const live = list.filter(a=>!a.cancelled);
  if(!live.length) return `<p class="tknote">No one has signed up yet.</p>`;

  // The ticket column only earns its place when there's more than one
  // ticket type to tell apart - otherwise it's the same word all the way down.
  const many = new Set(live.map(a=>a.ticket)).size > 1;
  const inCount = live.filter(a=>a.checkedIn).length;

  return `<p class="tksum">${live.length} signed up${inCount ? ` · ${inCount} checked in` : ""}</p>
    <table class="tkatt">
      <thead><tr><th>Name</th><th>Email</th>${many?"<th>Ticket</th>":""}<th>Status</th></tr></thead>
      <tbody>${live.map(a=>`<tr>
        <td class="nm">${esc(a.name)}</td>
        <td>${a.email ? `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : "—"}</td>
        ${many ? `<td>${esc(a.ticket||"—")}</td>` : ""}
        <td>${a.checkedIn ? `<span class="in">Checked in</span>` : esc(a.status||"—")}</td>
      </tr>`).join("")}</tbody>
    </table>`;
}

// ---------- loading ----------

async function load(force){
  if(TK.busy || (TK.loaded && !force)) return;
  TK.busy = true;
  const gen = TK.gen;
  status("");
  $("tk-loading").hidden = false;
  try{
    // The site on show's own Eventbrite account (pb_hooks/eventbrite.pb.js).
    const res = await pb.send("/api/eventbrite/events", { query: { site: siteId() } });
    if(gen !== TK.gen) return;
    TK.events = res.events || [];
    TK.byDate = new Map();
    TK.events.forEach(ev=>{
      const k = tkDayKey(ev.start);
      if(!TK.byDate.has(k)) TK.byDate.set(k, []);
      TK.byDate.get(k).push(ev);
    });
    TK.byDate.forEach(list=>list.sort((a,b)=>(a.start||"").localeCompare(b.start||"")));
    TK.attendees = new Map();
    // On first load, open on the month holding the year's next event
    // rather than today, so a quiet month doesn't present an empty grid. A
    // refresh redraws in place (same size, so the view stays put).
    const first = !TK.loaded;
    TK.loaded = true;
    yearStatus();
    if(first) showMonth(startMonth()); else renderYear();
  }catch(err){
    if(gen !== TK.gen) return;
    console.error(err);
    if(!MONTHS.length) showMonth(monthOf(defaultISO()));
    status(`Could not load Eventbrite data (${tkErr(err)}). Check the site's Eventbrite token is set (site_secrets, in Supabase Studio).`);
  }finally{
    if(gen === TK.gen){ TK.busy = false; $("tk-loading").hidden = true; }
  }
}

// Arrows: to a whole month. From a locked month, the next or previous
// one; from part-way between two, forward to the later or back to the
// earlier.
function step(dir){
  if(!MONTHS.length) return;
  const s = tkStrip(), at = s.offset;
  const to = s.locked ? s.index + dir : dir > 0 ? Math.floor(at + 0.01) + 1 : Math.ceil(at - 0.01) - 1;
  s.go(Math.min(Math.max(to, 0), MONTHS.length - 1));
}

export default {
  id: "pane-tickets",
  label: "Tickets",
  toolbar: { filter: false },
  init(){
    $("tk-grid").addEventListener("click", e=>{
      const b = e.target.closest("[data-ev]");
      if(b) openEvent(b.dataset.ev);
    });
    $("tk-prev").addEventListener("click", ()=>step(-1));
    $("tk-next").addEventListener("click", ()=>step(1));
    $("tk-today").addEventListener("click", ()=>{
      if(todayInPeriod()) tkStrip().go(monthIndex(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)));
    });
    $("tk-refresh").addEventListener("click", ()=>load(true));
    $("tk-create").addEventListener("click", openCreateEvent);
  },
  // Not render(): nothing here depends on the shared booking data or filter.
  show(){ $("tk-create").hidden = !canEdit(); tkStrip().flush(); load(false); },
  // Same events (they're fetched once, for every year); a new year to show.
  // Also when loading failed - the month must still move into the new year.
  periodChanged(){
    if(!MONTHS.length) return;   // never shown yet: load() picks the month
    TK.cursor = null;
    yearStatus();
    showMonth(startMonth());
  },
  // Another site, another Eventbrite account: drop the old one's events;
  // the next show() loads the new site's.
  siteChanged(){ this.reset(); },
  reset(){
    TK.gen++;
    TK.events = []; TK.byDate = new Map(); TK.attendees = new Map(); TK.cursor = null; MONTHS = [];
    TK.loaded = false; TK.busy = false;
    $("tk-month").textContent = "";
    $("tk-grid").innerHTML = "";
    $("tk-loading").hidden = true;
    status("");
  },
};
