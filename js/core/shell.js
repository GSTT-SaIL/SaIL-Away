/* The shell: everything around the views - sign-in, sign-out, the top bar
   (view picker, filter, Edit, Log out) and the start-up sequence.

   It knows the views only through the registry: each view registers an
   object, and the shell calls its hooks. It never names a particular view,
   so adding one doesn't mean editing this file. See docs/ARCHITECTURE.md.

   A view object:
     id       the id of its .pane element (omit for components without a pane)
     label    its name in the view picker (omit to leave it out of the picker)
     requires "admin" to list it only for admins (the data's API rules must
              enforce the same - this only hides the view)
     toolbar  { filter: placeholder text or false, expandAll, weekStepper,
              rowFilter: show the rows tick-list (#rowpick) - the view
              wires it itself }
     init()   once, at start-up: wire its own listeners
     render() redraw from the shared data/ui state
     show()   it has just become the visible view (e.g. lazy-load data)
     count()  text for the count in the top bar while it's visible
     toggleAll()  the top bar's Expand all / Collapse all button was clicked
     status(kind, message)  "loading" / "error" while the board loads
     periodChanged()  the financial year was switched (core/period.js) -
              drop anything from the old year; the shell reloads the shared
              data and re-renders afterwards
     siteChanged()  the site was switched (core/site.js) - drop everything
              from the old site; then as for periodChanged. Views without
              it get periodChanged() instead.
     reset()  sign-out: drop anything user-specific, from memory and page

   Views don't import each other; shared things live in core/ (data.js for
   booking data, `ui` below for UI state). */
import { pb } from "./pb.js";
import { loadAll, clearData } from "./data.js";
import { mondayOf, parseISO } from "./util.js";
import { tell } from "./dialog.js";
import { makePicker } from "./picker.js";
import { loadPrefs, clearPrefs, pref, setPref } from "./prefs.js";
import { period, setPeriod, initialYear, fyOfISO, fyLabel, CURRENT_FY, defaultISO } from "./period.js";
import { site, loadSites, setSite, clearSites, canEdit, hasView, siteFilter, paintBrand, siteColour } from "./site.js";

// The week to show in a year: this week if it's in the year, else the
// year's nearest end.
const defaultWeek = () => mondayOf(parseISO(defaultISO()));

// UI state more than one view reads.
export const ui = {
  q: "",              // the filter box, lower-cased
  editing: false,     // admin edit mode
  weekStart: defaultWeek(),    // week on show in Timetable/Availability,
                               // always inside the financial year on show
};

const views = [];
let current = null;

export function register(view){ views.push(view); }

// Redraw every view - except the one that caused the change, when it has
// already updated itself (re-rendering it could replace the input being
// typed into).
export function rerender(exceptId){
  views.forEach(v=>{ if(v.id !== exceptId) v.render?.(); });
  updateCount();
}

// The count in the top bar belongs to whichever view is on show.
export function updateCount(){
  document.getElementById("count").textContent = (current && current.count?.()) || "";
}

export function reportSaveError(err){
  console.error(err);
  if(err && (err.status === 401 || err.status === 403)){
    tell("Your session has expired. Please sign in again.");
    signOut();
    return;
  }
  tell("Could not save that change: "+(err && err.message ? err.message : err));
}

/* ------------------------------ auth UI ------------------------------ */
function updateAuthUI(){
  document.getElementById("logout-btn").style.display = pb.authStore.isValid ? "" : "none";
  document.getElementById("edit-toggle").style.display = canEdit() ? "" : "none";
}

// Sign-in is mandatory to see any data - there is no Cancel and no
// backdrop/Escape dismissal on this one. promptLogin() only resolves once
// authWithPassword actually succeeds.
let loginResolve = null;
function openLogin(){
  document.getElementById("login-error").style.display = "none";
  document.getElementById("login-email").value = "";
  document.getElementById("login-password").value = "";
  document.getElementById("login-remember").checked = false;
  document.getElementById("login-backdrop").classList.add("open");
  document.getElementById("login-email").focus();
}
function closeLogin(){
  document.getElementById("login-backdrop").classList.remove("open");
  if(loginResolve){ loginResolve(); loginResolve = null; }
}
function promptLogin(){
  return new Promise(resolve=>{ loginResolve = resolve; openLogin(); });
}
async function submitLogin(){
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if(!email || !password) return;
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";
  pb.authStore.remember = document.getElementById("login-remember").checked;
  try{
    await pb.collection("users").authWithPassword(email, password);
    closeLogin();
  }catch(err){
    errEl.textContent = "Sign in failed. Check the email and password.";
    errEl.style.display = "block";
  }
}

function setEditing(on){
  ui.editing = on;
  document.body.classList.toggle("editing", on);
  const btn = document.getElementById("edit-toggle");
  btn.textContent = on ? "Done" : "Edit";
  btn.classList.toggle("on", on);
}

// Shared by Log out and an expired session. Drops everything loaded in
// memory and rendered on screen - "no data visible until logged in" has to
// hold after logging out again, not just before first login, and the next
// person to sign in on this browser mustn't inherit the last one's data.
// Anything new that holds user data must be cleared by its view's reset().
function signOut(){
  pb.authStore.clear();
  setEditing(false);
  document.body.classList.remove("authed");
  clearData();
  clearSites();
  clearPrefs();
  views.forEach(v=>v.reset?.());
  updateCount();
  boot();
}

/* ------------------------------ start-up ----------------------------- */
async function boot(){
  // Nothing below runs - and .authed (which is what reveals .banner/.app,
  // see the CSS) never gets set - until sign-in succeeds. No data is
  // requested from the database before that either.
  let freshLogin = false;
  while(!pb.authStore.isValid){ await promptLogin(); freshLogin = true; }
  // The sign-in dialog starts open in index.html so it shows immediately on
  // load. A session restored from storage skips promptLogin() entirely, so
  // nothing else would close it - it would sit on top of the board.
  document.getElementById("login-backdrop").classList.remove("open");

  // A restored sign-in gets swapped for a fresh token: restarts the 5-day
  // clock (so "keep me signed in" lasts as long as the board is in use),
  // and re-reads the account, so a deleted user or a role change takes
  // effect now rather than whenever the old token would have expired.
  if(!freshLogin){
    try{
      await pb.collection("users").authRefresh();
    }catch(err){
      if(err && err.status >= 400 && err.status < 500){
        pb.authStore.clear();
        return boot();
      }
      // Network/server trouble: carry on with the stored token - loadAll()
      // below reports the connection problem properly.
    }
  }

  // Set before .app becomes visible so a viewer never sees Edit flash on
  // screen, even for a frame, while loadAll() below is in flight.
  updateAuthUI();
  document.body.classList.add("authed");
  views.forEach(v=>v.status?.("loading"));
  try{
    // Their own view settings first (core/prefs.js) - they say which site
    // and year to open on - then the sites they hold (core/site.js).
    await loadPrefs();
    setBannerHidden(!!pref("bannerHidden"));
    setPeriod(initialYear(pref("fy")));
    ui.weekStart = defaultWeek();
    await loadSites();
    buildSiteOptions();
    if(!site.current){
      views.forEach(v=>v.status?.("error", "Your account hasn't been given a site yet. Ask an admin to add one in the dashboard."));
      return;
    }
    await buildYearOptions();
    await loadAll();
  }catch(err){
    console.error(err);
    if(err && (err.status === 401 || err.status === 403)){
      // Stored session is stale/rejected server-side - clear it and go
      // back through the gate rather than showing a dead board.
      pb.authStore.clear();
      document.body.classList.remove("authed");
      return boot();
    }
    views.forEach(v=>v.status?.("error",
      `Could not reach the booking database (${err.message||err}). `+
      `Check your connection, and that js/config.js points at the Supabase project.`));
    return;
  }
  updateAuthUI();
  // Which views this account may see (admin-only ones drop out for viewers),
  // opening the one in the address if there is one.
  ready = true;
  buildViewOptions();
  rerender();
  // A view that loads lazily (Tickets) may be the one on show - e.g. after
  // signing out on it and back in - so give it the chance to load now.
  current?.show?.();
}

/* ------------------------- financial year ---------------------------- */
// The banner's selector lists every year that has sessions or quotes, plus
// this year and next, so there's always somewhere to plan into. Built after
// sign-in, from four one-record queries (the earliest and latest dates).
async function buildYearOptions(){
  const edge = async (collection, sort) => {
    try{
      // requestKey:null - these run two at a time per collection, and the SDK
      // would otherwise cancel the first.
      const res = await pb.collection(collection).getList(1, 1, { sort, filter: 'date != "" && ' + siteFilter(), fields: "date", requestKey: null });
      return res.items[0]?.date ? fyOfISO(res.items[0].date) : null;
    }catch{ return null; }   // a list failing here mustn't stop the board loading
  };
  const found = (await Promise.all([
    edge("sessions", "date"), edge("sessions", "-date"),
    edge("invoices", "date"), edge("invoices", "-date"),
  ])).filter(y=>y !== null);
  const years = [...found, CURRENT_FY, CURRENT_FY + 1, period.year];
  const from = Math.min(...years), to = Math.max(...years);
  const list = [];
  for(let y = to; y >= from; y--) list.push({ value: y, label: fyLabel(y) });
  yearPicker.set(list, period.year);
}

async function switchYear(year){
  setPeriod(year);
  setPref("fy", year);
  ui.weekStart = defaultWeek();
  views.forEach(v=>{ v.periodChanged?.(); v.status?.("loading"); });
  try{
    await loadAll();
  }catch(err){
    if(err && (err.status === 401 || err.status === 403)){ reportSaveError(err); return; }
    console.error(err);
    views.forEach(v=>v.status?.("error", `Could not load ${period.label} (${err.message||err}).`));
    return;
  }
  rerender();
  current?.show?.();
}

/* ------------------------------- site -------------------------------- */
// The banner shows the site on show: its logo or wordmark, and its colour
// for the sliver left when the banner is hidden (css .bantab).
function paintSite(){
  paintBrand(site.current, $("brand-logo"), $("brand-mark"));
  document.body.style.setProperty("--site-accent", siteColour(site.current));
}

// Hide/show the banner for more room (the user's design, 2026-10-09);
// remembered per person.
function setBannerHidden(on){
  document.body.classList.toggle("banner-hidden", on);
  const b = $("banner-toggle");
  b.setAttribute("aria-expanded", String(!on));
  b.setAttribute("aria-label", on ? "Show the banner" : "Hide the banner");
  b.title = on ? "Show the banner" : "Hide the banner";
}

// The banner's site selector: the sites this person holds. Only shown to
// someone with more than one (the user's call, 2026-10-07).
function buildSiteOptions(){
  sitePicker.set(site.list.map(s=>({ value: s.id, label: s.name })), site.current?.id);
  $("site-wrap").hidden = site.list.length < 2;
  paintSite();
}

// Like switching year: drop the old site's data, load the new one's. Its
// years, views and whether you can edit there may all differ.
async function switchSite(id){
  if(id === site.current?.id) return;
  setSite(id);
  setPref("site", id);
  paintSite();
  setEditing(false);
  views.forEach(v=>{ (v.siteChanged || v.periodChanged)?.call(v); v.status?.("loading"); });
  updateAuthUI();
  buildViewOptions();
  try{
    await buildYearOptions();
    await loadAll();
  }catch(err){
    if(err && (err.status === 401 || err.status === 403)){ reportSaveError(err); return; }
    console.error(err);
    views.forEach(v=>v.status?.("error", `Could not load ${site.current?.name || "that site"} (${err.message||err}).`));
    return;
  }
  rerender();
  current?.show?.();
}

/* ---------------------------- view picker ---------------------------- */
/* The view on show is in the address - #courses, #rota, #apps ... (each
   view's pane id without "pane-") - so Back after leaving the board, a
   bookmark or a shared link opens the same view (the user's call,
   2026-10-14). Switching views *replaces* the address rather than adding
   history, so Back still leaves the board instead of stepping through
   views. Only once signed in: a view shown before that would load its
   data while signed out. */
const viewKey = v => v.id.replace(/^pane-/, "");
let ready = false;                                   // signed in, sites known
let wanted = decodeURIComponent(location.hash.slice(1));   // the address's view, until used

function showView(view){
  current = view;
  if(ready && location.hash !== "#" + viewKey(view)) history.replaceState(null, "", "#" + viewKey(view));
  views.forEach(v=>{ if(v.id) document.getElementById(v.id).classList.toggle("on", v===view); });
  const tb = view.toolbar || {};
  document.getElementById("collapse-all").style.visibility = tb.expandAll ? "visible" : "hidden";
  document.getElementById("tb-timetable").style.display = tb.weekStepper ? "flex" : "none";
  const q = document.getElementById("q");
  if(tb.filter) q.placeholder = tb.filter;
  // Hides the filter box, which doesn't apply to every view (see the CSS).
  document.body.classList.toggle("no-filter", !tb.filter);
  // The rows tick-list (core/tickpick.js) in its place, for views that ask.
  document.body.classList.toggle("row-filter", !!tb.rowFilter);
  updateCount();
  view.show?.();
}

/* The view picker and the banner's year picker are the same component,
   core/picker.js. The view options are built from the registry, per
   account (buildViewOptions), so they're rebuilt on sign-in. */
const $ = id => document.getElementById(id);
let viewPicker = null, yearPicker = null, sitePicker = null;

// The views this account may see on this site: the site's own views
// (sites.views), less admin-only ones for people who can't edit.
function buildViewOptions(){
  const listed = views.filter(v=>v.label && hasView(viewKey(v)) &&
    (v.requires !== "admin" || canEdit()));
  // The address's view first (once signed in, and if this site has it);
  // otherwise stay on the current view if this account can still see it.
  const fromUrl = ready && wanted ? listed.find(v=>viewKey(v) === wanted) : null;
  if(ready) wanted = "";
  const keep = fromUrl || (listed.includes(current) ? current : listed[0]);
  viewPicker.set(listed.map(v=>({ value: v, label: v.label })), keep);
  if(keep !== current) showView(keep);
  else if(ready && current && location.hash !== "#" + viewKey(current)) history.replaceState(null, "", "#" + viewKey(current));
}

/* ------------------------------- wiring ------------------------------ */
export function start(){
  // Site and year used to be remembered per browser; now per person
  // (core/prefs.js). Drop the old copies.
  try{ localStorage.removeItem("facilities.site"); localStorage.removeItem("facilities.fy"); }catch{ /* storage blocked */ }
  pb.authStore.onChange(updateAuthUI);

  document.getElementById("login-submit").addEventListener("click", submitLogin);
  document.getElementById("login-password").addEventListener("keydown", e=>{
    if(e.key==="Enter") submitLogin();
  });
  document.getElementById("logout-btn").addEventListener("click", signOut);
  $("banner-toggle").addEventListener("click", ()=>{
    const on = !document.body.classList.contains("banner-hidden");
    setBannerHidden(on);
    setPref("bannerHidden", on || undefined);
  });

  document.getElementById("edit-toggle").addEventListener("click", ()=>{
    // Signing in is already required just to see the board (see boot()), so
    // reaching this button means pb.authStore is valid - no login prompt here.
    setEditing(!ui.editing);
    rerender();
  });

  yearPicker = makePicker($("fy"), item=>switchYear(item.value));
  sitePicker = makePicker($("sitep"), item=>switchSite(item.value));

  document.getElementById("q").addEventListener("input", e=>{
    ui.q = e.target.value.trim().toLowerCase();
    rerender();
  });

  // Shown only for views whose toolbar asks for it; the view does the work.
  document.getElementById("collapse-all").addEventListener("click", ()=>{
    current?.toggleAll?.();
  });

  views.forEach(v=>v.init?.());
  viewPicker = makePicker($("view"), item=>showView(item.value));
  // A view typed into the address (or a link followed) while the board is open.
  window.addEventListener("hashchange", ()=>{
    if(!ready || location.hash === "#" + (current && viewKey(current))) return;
    wanted = decodeURIComponent(location.hash.slice(1));
    buildViewOptions();
  });
  buildViewOptions();
  boot();
}
