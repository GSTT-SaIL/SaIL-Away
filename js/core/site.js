/* The site on show - the banner's site selector (core/shell.js), the twin
   of core/period.js (docs/MULTISITE-PLAN.md).

   The board shows one site's data at a time. Unlike the year, this IS a
   security boundary - but not here: the server's rules only ever return
   the sites a person holds (pb_migrations/1735000021_sites.js), whatever
   this file asks for. This decides which of those is on show.

   Views never work the site out for themselves: they load with
   siteFilter(), file new top-level records under siteId(), and ask
   canEdit() and hasView(), so "which site" is decided in one place.

   "All" (the user's call, 2026-10-07): every site at once, for admins
   only (when there's more than one site), view-only, Courses and
   Timetable only. It isn't a stored site - just the first entry in the list,
   and siteIds() then means every real site, so loading needs nothing
   special. Nothing can be created or edited in it (canEdit() is false and
   the server refuses a record without a real site). */
import { pb } from "./pb.js";
import { pref } from "./prefs.js";


// Mutated in place (never reassigned), like the data stores.
//   list    - the sites this person holds, in order (admins: all of them)
//   current - the site on show
export const site = { list: [], current: null };

// The sites this person holds. The server's rule filters them; the Eventbrite
// fields are hidden on the server and never arrive.
export const ALL_ID = "all";
const ALL = { id: ALL_ID, name: "All", full_name: "All sites", colour: "#334155", views: ["courses", "timetable", "rota", "staff"], all: true };

export async function loadSites(){
  const recs = await pb.collection("sites").getFullList({ sort: "sort", fields: "id,name,code,views,logo,colour,full_name,eventbrite_venues", requestKey: null });
  const admin = pb.authStore.record?.role === "admin";
  // "All" heads the list when it's offered (the user's call, 2026-10-07).
  site.list = admin && recs.length > 1 ? [ALL, ...recs] : recs;
  // The person's last choice (core/prefs.js "site" - it follows them, the
  // user's call 2026-10-09), if they still hold it; else their first site.
  const last = pref("site");
  setSite(site.list.some(s => s.id === last) ? last : recs[0]?.id);
}

export function setSite(id){
  site.current = site.list.find(s => s.id === id) || site.list[0] || null;
}
export const clearSites = () => { site.list = []; site.current = null; };

// How a site shows itself in the banner (pb_migrations/1735000023): the
// logo image, or a wordmark - its name in its colour, its full name under.
export const DEFAULT_COLOUR = "#0e7c86";
export const siteColour = s => (s && s.colour) || DEFAULT_COLOUR;
// A light wash of a site's colour, for headers (as a group's tint).
export const siteTint = s => `color-mix(in srgb, ${siteColour(s)} 13%, #fff)`;
export const siteById = id => site.list.find(s => s.id === id);
export const isAll = () => !!site.current?.all;
export function paintBrand(s, img, mark){
  const wordmark = !!s && !s.logo;
  img.hidden = wordmark;
  mark.hidden = !wordmark;
  if(!wordmark) return;
  mark.style.setProperty("--site", siteColour(s));
  mark.querySelector(".nm").textContent = s.name;
  const sub = mark.querySelector(".sub");
  sub.textContent = s.full_name || "";
  sub.hidden = !s.full_name;
  mark.setAttribute("aria-label", s.full_name ? `${s.name} - ${s.full_name}` : s.name);
}

// The sites on show (one, until "All" exists) and where new records go.
export const siteIds = () => !site.current ? [] : site.current.all
  ? site.list.filter(s => !s.all).map(s => s.id) : [site.current.id];
// Where a new record goes - nowhere, in All.
export const siteId = () => (site.current && !site.current.all && site.current.id) || "";
// A site's place in the list, for ordering things from several sites.
export const siteOrder = id => { const i = site.list.findIndex(s => s.id === id); return i === -1 ? 999 : i; };

// A PocketBase filter for "this record's site is one on show". `field` is
// the record's site, or a path to it (e.g. "session.site").
export function siteFilter(field = "site"){
  const ids = siteIds();
  if(!ids.length) return 'id = "-"';   // no site: nothing
  return "(" + ids.map(id => pb.filter(field + " = {:s}", { s: id })).join(" || ") + ")";
}
// Joined to another filter ("" means none).
export const andSite = (filter, field) => filter ? `(${filter}) && ${siteFilter(field)}` : siteFilter(field);

// Which views this site has (sites.views, ticked in the dashboard; none
// ticked means all of them). `key` is the view's pane id without "pane-".
export function hasView(key){
  const views = site.current?.views || [];
  return !views.length || views.includes(key);
}

// May this person change the site on show? Admins anywhere; editors on
// their own sites; viewers never. A UI convenience - the server's rules
// enforce the same thing.
export function canEdit(){
  const u = pb.authStore.record;
  if(!u || isAll()) return false;   // All is view-only
  if(u.role === "admin") return true;
  return u.role === "editor" && (u.sites || []).includes(siteId());
}
