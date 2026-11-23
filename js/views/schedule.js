/* Timetable (#pane-timetable) and Rota (#pane-rota): the same row x day
   grid, drawn by core/grid.js - rooms for the Timetable, staff for the Rota
   (its own section below). The Timetable shows bookings in their group
   colours, opens the detail sheet on click, and has the "Copy availability
   link" button for the public availability.html (occupancy only) - the
   board's own Availability view was removed (the user's call, 2026-10-09).
   Both share the week stepper toolbar (#tb-timetable).

   Each grid is the whole financial year as one strip of day columns, sized
   so a week fills the view (core/strip.js, the user's design 2026-10-07):
   drag, swipe or scroll through the days freely, or use the arrows / Today
   to glide to a whole Monday-to-Sunday week and lock there. It opens with
   the current week locked. The two views show the same place. */
import { BOOKINGS, GROUPS, G, ROOMS, ROOM_LIST } from "../core/data.js";
import { addDays, mondayOf, TODAY, esc, parseISO, toISO } from "../core/util.js";
import { paintGrid, weekLabel } from "../core/grid.js";
import { makeStrip } from "../core/strip.js";
import { ui } from "../core/shell.js";
import { period, inPeriod, todayInPeriod } from "../core/period.js";
import { openSession } from "./sheet.js";
import { site, isAll, siteById, siteColour, siteFilter, andSite, siteOrder } from "../core/site.js";
import { pb } from "../core/pb.js";
import { makeTickPicker } from "../core/tickpick.js";
import { pref, setPref } from "../core/prefs.js";

const $ = id => document.getElementById(id);

// The strip runs from the Monday of the week holding 1 April to the Sunday
// of the week holding 31 March. Days of those weeks outside the year are
// greyed (paintGrid's `outside`).
let DAYS = [];
const drawn = {};   // grid id -> the year it was last drawn for
const outside = iso => !inPeriod(iso);
function yearDays(){
  const first = mondayOf(parseISO(period.start)), last = addDays(mondayOf(parseISO(period.end)), 6);
  const n = Math.round((last - first) / 86400000) + 1;   // rounded: clock changes
  return Array.from({ length: n }, (_, i) => addDays(first, i));
}
const indexOf = d => Math.round((mondayOf(d) - DAYS[0]) / 86400000) + ((d.getDay() + 6) % 7);
const lastStart = () => Math.max(DAYS.length - 7, 0);

// One strip per grid; whichever is on show drives the toolbar.
const strips = {};
const dayWidth = grid => grid.querySelector(".h")?.getBoundingClientRect().width || 0;
function strip(id){
  return strips[id] ||= makeStrip({
    wrap: $(id).parentElement, axis: "x", unit: () => dayWidth($(id)),
    onMove: (i, locked) => moved(id, i, locked),
  });
}
const shownId = () => ["tt", "ro"].find(id => $(id).parentElement.clientWidth) || null;

// After any move: the label and arrows follow the view on show, and the
// shared state remembers where it is, for the other view and new sessions.
let place = { i: null, locked: true };
function moved(id, i, locked){
  if(!DAYS.length || id !== shownId()) return;
  i = Math.min(Math.max(i, 0), DAYS.length - 1);
  place = { i, locked };
  ui.weekStart = mondayOf(DAYS[i]);
  $("week-label").textContent = weekLabel(DAYS[i], DAYS[Math.min(i + 6, DAYS.length - 1)]);
  $("prev-week").disabled = i <= 0;
  $("next-week").disabled = i >= lastStart();
  const today = $("this-week");
  today.disabled = !todayInPeriod();
  today.title = today.disabled ? `Today is outside ${period.label}` : "";
}

// Draw a grid; on a new year start on ui.weekStart (the current week, or
// the year's nearest end), locked. Otherwise the strip keeps its place.
function paint(id, opts){
  const newYear = drawn[id] !== period.label;
  DAYS = yearDays();
  paintGrid($(id), { days: DAYS, rooms: ROOMS, bookings: BOOKINGS, outside, ...opts });   // opts may give its own rooms
  drawn[id] = period.label;
  if(newYear) strip(id).go(indexOf(ui.weekStart), { smooth: false });
}

/* The rows on show, and their order (the user's designs, 2026-10-09). Each
   person can hide rows from their own view with the tick-list left of
   Today (core/tickpick.js; it replaced the filter box here), and move a row
   up or down with the arrows on its label. Saved to their account
   (core/prefs.js) per site - All has its own - and never changes anyone
   else's view. Two sets of rows: rooms (the Timetable) and people (the
   Rota). */
const siteKey = () => isAll() ? "all" : site.current?.id || "";
let rowPick = null, pickSet = null, flash = null;

const SETS = {
  rooms: {
    noun: "rooms", grids: ["tt"],
    hide: () => "hideRooms:" + siteKey(), order: () => "roomOrder:" + siteKey(),
    // "All" (core/site.js, the user's design 2026-10-07): every site's rooms,
    // each labelled with its site in the site's colour, keyed site|room (two
    // sites can share a room name). A site's own rooms are just their names.
    base: () => isAll()
      ? ROOM_LIST.map(r => { const s = siteById(r.site); return { key: r.site + "|" + r.name, name: r.name, tag: s?.name || "", colour: siteColour(s) }; })
      : ROOMS.map(name => ({ key: name, name })),
  },
  people: {
    noun: "people", grids: ["ro"],
    hide: () => "hideStaff:" + siteKey(), order: () => "staffOrder:" + siteKey(),
    // The site's staff, keyed by account; in All labelled by site like rooms.
    base: () => ROTA.people.map(p => {
      const s = siteById(p.site);
      return isAll() ? { key: p.id, name: p.name, tag: s?.name || "", colour: siteColour(s) } : { key: p.id, name: p.name };
    }),
  },
};
const setOf = id => id === "ro" ? SETS.people : SETS.rooms;

// A saved order puts its rows first, in that order; any row it doesn't
// know (a new room, a new person) follows, in the usual order.
function allRows(set){
  const rank = new Map(pref(set.order(), []).map((k, i) => [k, i]));
  return set.base().map((r, i) => ({ r, i: rank.has(r.key) ? rank.get(r.key) : rank.size + i }))
    .sort((a, b) => a.i - b.i).map(x => x.r);
}
const shownRows = set => { const hide = new Set(pref(set.hide(), [])); return allRows(set).filter(r => !hide.has(r.key)); };

const RENDER = { tt: () => renderTimetable(), ro: () => renderRota() };
const DRAW = { tt: () => drawTimetable(), ro: () => drawRota() };

// An arrow on a row's label: swap it with the next row on show above or
// below (hidden rows keep their places between them).
function moveRow(set, key, dir){
  const all = allRows(set).map(r => r.key), shown = shownRows(set).map(r => r.key);
  const other = shown[shown.indexOf(key) + dir];
  if(!other) return;
  const a = all.indexOf(key), b = all.indexOf(other);
  [all[a], all[b]] = [all[b], all[a]];
  setPref(set.order(), all);
  flash = key;
  set.grids.forEach(id => RENDER[id]());
  flash = null;
  // Keep the keyboard on the row that moved.
  const id = shownId();
  if(id) $(id).querySelector(`.room.flash [data-move="${dir}"]:not(:disabled)`)?.focus({ preventScroll: true });
}
const onMoveClick = id => e => {
  const b = e.target.closest("[data-move]");
  if(!b) return false;
  moveRow(setOf(id), b.dataset.row, +b.dataset.move);
  return true;
};

// The one tick-list serves whichever grid is on show.
function syncRowPick(id){
  pickSet = setOf(id);
  rowPick.set(allRows(pickSet).map(r => ({ value: r.key, label: r.name, tag: r.tag, colour: r.colour })), pref(pickSet.hide(), []), pickSet.noun);
}

// render*: rebuild the tick-list too (when that grid is the one on show);
// draw*: just the grid (ticking redraws without rebuilding the open menu
// under the pointer).
function renderTimetable(){ if(shownId() === "tt") syncRowPick("tt"); drawTimetable(); }

function drawTimetable(){
  const rooms = shownRows(SETS.rooms);
  // All: bookings plain grey, matched to their room within their own site;
  // no key bar. A site's own Timetable is untouched by any of this.
  $("tt-key").hidden = isAll();
  if(isAll()){
    paint("tt", { neutral: true, roomOf: b => b.site + "|" + b.room, rooms, reorder: true, flash });
    return;
  }
  $("legend-b").innerHTML = GROUPS.map(g=>
    `<span style="background:${g.tint};color:${g.ink}">${esc(g.name)}</span>`).join("");
  paint("tt", { groups: G, rooms, reorder: true, flash });
}

/* ------------------------------- Rota ---------------------------------- */
/* The Timetable's grid with the site's staff as rows instead of rooms (the
   user's design, 2026-10-09), showing their leave (the Staff view's data -
   pb_migrations/1735000026) as hatched boxes, and the sessions they're
   allocated to as filled ones. Whole days fill the day; hours sit at their
   times. Coloured by kind, the key under it. View-only. Its data loads the
   first time it's shown, and again for a new year or site. */
const KINDS = {
  annual: { name: "Annual leave", ink: "#1d4ed8", tint: "#e3ebfd" },
  wfh:    { name: "WFH",          ink: "#047857", tint: "#dcf3e8" },
  sick:   { name: "Sick",         ink: "#b45309", tint: "#fcefdc" },
};
const ROTA = { people: [], bookings: [], loaded: false, loading: null, gen: 0 };

async function loadRota(){
  if(ROTA.loading) return ROTA.loading;
  const g = ROTA.gen;
  ROTA.loading = (async () => {
    try{
      const [people, leave] = await Promise.all([
        pb.collection("staff").getFullList({ sort: "name", filter: siteFilter(), requestKey: null }),
        pb.collection("leave").getFullList({ requestKey: null,
          filter: andSite(pb.filter("start <= {:end} && end >= {:start}", { start: period.start, end: period.end })) }),
      ]);
      if(g !== ROTA.gen) return;
      // In All: only the sites that have a Rota, site by site.
      ROTA.people = (isAll() ? people.filter(p => siteById(p.site)?.views?.includes("rota")) : people)
        .sort((a, b) => siteOrder(a.site) - siteOrder(b.site) || a.name.localeCompare(b.name))
        .map(p => ({ id: p.id, name: p.name, site: p.site }));
      // One block per day of each entry, inside the year.
      ROTA.bookings = [];
      leave.forEach(l => {
        const k = KINDS[l.kind] || { name: l.kind };
        const hours = !!l.from, note = (l.note || "").trim();
        for(let d = parseISO(l.start); toISO(d) <= l.end; d = addDays(d, 1)){
          const iso = toISO(d);
          if(!inPeriod(iso)) continue;
          ROTA.bookings.push({
            id: l.id, room: l.person, date: iso, group: l.kind, courseTitle: k.name, hatch: true,
            start: hours ? l.from : "08:00", end: hours ? l.to : "18:00",
            meta: hours ? (note ? `${l.from}–${l.to} · ${note}` : `${l.from}–${l.to}`) : (note || "All day"),
            tip: `${k.name}${hours ? `, ${l.from} to ${l.to}` : ""}${note ? ` - ${note}` : ""}`,
          });
        }
      });
      ROTA.loaded = true;
      renderRota();
    }catch(err){
      if(g !== ROTA.gen) return;
      console.error(err);
      $("ro").innerHTML = `<div class="empty">Could not load the rota (${esc(err.message || err)}).</div>`;
    }finally{ ROTA.loading = null; }
  })();
  return ROTA.loading;
}
function forgetRota(){ ROTA.gen++; ROTA.loaded = false; ROTA.loading = null; ROTA.people = []; ROTA.bookings = []; }

// Sessions people are allocated to (the session pop-up's Allocate tab), as
// filled boxes in their course group's colour; leave is hatched (the
// user's calls, 2026-10-09). Click one to open the session.
function allocations(){
  const here = new Set(ROTA.people.map(p => p.id));
  return BOOKINGS.flatMap(b => (b.staff || []).filter(id => here.has(id)).map(id => ({
    id: b.id, room: id, date: b.date, start: b.start, end: b.end, group: b.group,
    courseTitle: b.courseTitle, meta: `${b.title} · ${b.start}–${b.end}`,
    tip: `${b.courseTitle}: ${b.title}, ${b.start} to ${b.end}${b.room ? `, ${b.room}` : ""}`,
  })));
}

function renderRota(){ if(!ROTA.loaded) return; if(shownId() === "ro") syncRowPick("ro"); drawRota(); }
function drawRota(){
  if(!ROTA.loaded) return;
  $("legend-ro").innerHTML = Object.values(KINDS).map(k =>
    `<span class="hatch" style="--btint:${k.tint};color:${k.ink}">${esc(k.name)}</span>`).join("") +
    `<span style="background:var(--group);color:var(--fg-2)">Allocated to a course</span>`;
  paint("ro", { rooms: shownRows(SETS.people), bookings: [...ROTA.bookings, ...allocations()],
    groups: { ...G, ...KINDS }, reorder: true, flash, corner: "Staff" });
}

// Switching between the grids: the one coming on show takes the same place
// (locked or not), drives the toolbar, and has the rows tick-list.
function showGrid(id){
  syncRowPick(id);
  strip(id).flush();
  if(!DAYS.length || place.i === null) return;
  strip(id).go(place.i, { smooth: false, lock: place.locked });
}

// Arrows: to a whole week. From a locked week, the next or previous one;
// from a free position, forward to next Monday or back to this week's.
function stepWeek(dir){
  const id = shownId(); if(!id) return;
  const s = strip(id), i = s.index, monday = i - ((DAYS[i].getDay() + 6) % 7);
  const to = s.locked ? i + 7 * dir : dir > 0 ? monday + 7 : (i === monday ? i - 7 : monday);
  s.go(Math.min(Math.max(to, 0), lastStart()));
}

/* Copies a link to availability.html - the public, sign-in-free room grid,
   reached only by this link (the Timetable's "Copy availability link").
   It reads /api/availability, which returns room/date/start/end only, so the
   link exposes room occupancy and nothing else. */
async function sharePublicLink(){
  // The site on show's own page (?site=<code>; pb_hooks/availability.pb.js).
  const url = new URL("availability.html?site=" + encodeURIComponent(site.current?.code || ""), location.href).href;
  const done = $("share-av-done");
  try{
    // Needs a secure context; fine on localhost and on any https deployment.
    await navigator.clipboard.writeText(url);
    done.textContent = "Copied";
    done.style.display = "inline";
    setTimeout(()=>{ done.style.display = "none"; }, 2600);
  }catch{
    // Fall back to showing it, so the link is still reachable if the
    // clipboard API is blocked (plain http, or a locked-down browser).
    done.textContent = url;
    done.style.display = "inline";
  }
}

export const timetable = {
  id: "pane-timetable",
  label: "Timetable",
  toolbar: { filter: false, rowFilter: true, weekStepper: true },
  init(){
    // The rows tick-list and the week stepper are shared with the Rota;
    // wired once, here.
    rowPick = makeTickPicker($("rowpick"), { noun: "rooms", onChange: hidden => {
      setPref(pickSet.hide(), [...hidden]);
      pickSet.grids.forEach(id => { if(drawn[id]) DRAW[id](); });
    } });
    $("prev-week").addEventListener("click", ()=>stepWeek(-1));
    $("next-week").addEventListener("click", ()=>stepWeek(1));
    $("this-week").addEventListener("click", ()=>{
      const id = shownId();
      if(id && todayInPeriod()) strip(id).go(indexOf(mondayOf(TODAY)));
    });
    $("share-av").addEventListener("click", sharePublicLink);
    $("tt").addEventListener("click", e=>{
      if(onMoveClick("tt")(e)) return;
      const o = e.target.closest("[data-open]");
      if(o && !ui.editing) openSession(o.getAttribute("data-open"));
    });
  },
  render: renderTimetable,
  show(){ showGrid("tt"); },
  periodChanged(){ place = { i: null, locked: true }; },
  reset(){ $("tt").innerHTML = ""; $("legend-b").innerHTML = ""; delete drawn.tt; place = { i: null, locked: true }; },
};

export const rota = {
  id: "pane-rota",
  label: "Rota",
  toolbar: { filter: false, rowFilter: true, weekStepper: true },
  init(){
    $("ro").addEventListener("click", e => {
      if(onMoveClick("ro")(e)) return;
      // A course allocation (filled) opens its session; leave (hatched)
      // doesn't open anything.
      const o = e.target.closest(".blk[data-open]:not(.hatch)");
      if(o && !ui.editing) openSession(o.dataset.open);
    });
  },
  render: renderRota,
  async show(){
    if(!ROTA.loaded){ $("ro").innerHTML = `<div class="empty">Loading&hellip;</div>`; delete drawn.ro; await loadRota(); }
    showGrid("ro");
  },
  periodChanged(){ forgetRota(); },
  siteChanged(){ forgetRota(); },
  reset(){ forgetRota(); $("ro").innerHTML = ""; $("legend-ro").innerHTML = ""; delete drawn.ro; },
};
