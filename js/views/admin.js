/* Admin page (#pane-admin, the user's design 2026-11-04): what only a
   superuser could change in the dashboard before - accounts, site details,
   and each site's rooms and departments. Admin accounts only: it's listed for
   them on every site and in All, and the API rules (1735000039) hold the same
   line. It isn't about the site on show - it covers all of them.

   The shared grouped list, two groups: Accounts and Sites. A row opens the
   item pop-up: an account's form, or a site's Details, Rooms and Departments.
   Forms save with their button. Rooms and departments save as they change.
   Whatever the rest of the board reads from these is reloaded when the
   pop-up closes (refreshBoard).

   Not here, on purpose: a site's code (public links are built on it), its
   Eventbrite settings, and adding or deleting a site - the dashboard only. */
import { pb } from "../core/pb.js";
import { CHEV, esc } from "../core/util.js";
import { ui, updateCount, refreshBoard } from "../core/shell.js";
import { PALETTE } from "../core/data.js";
import { DEFAULT_COLOUR, siteColour, siteTint } from "../core/site.js";
import { lineUp } from "../core/rowdetails.js";
import { ask, tell } from "../core/dialog.js";
import { openItem, closeItem } from "./sheet.js";

const ID = "pane-admin";
const $ = id => document.getElementById(id);
const USERS = [], SITES = [];
const openGroups = new Set();   // collapsed by default, like every board
let loaded = false, loading = null, countText = "";

const ROLES = [["admin", "Admin"], ["editor", "Editor"], ["viewer", "Viewer"]];
const roleName = r => (ROLES.find(x => x[0] === r) || [r, r])[1];
const VIEWS = [["courses", "Courses"], ["timetable", "Timetable"], ["rota", "Rota"], ["tickets", "Tickets"],
  ["invoices", "Invoices"], ["forms", "Forms"], ["staff", "Staff"], ["apps", "Apps"]];
const siteName = id => SITES.find(s => s.id === id)?.name || "";
const me = () => pb.authStore.record?.id;

// What the server said, in words: a field's own message if it gave one.
function reason(err){
  const f = Object.entries(err?.data?.data || {})[0];
  return f ? `${f[0].replace(/^./, c => c.toUpperCase())}: ${f[1].message}` : (err?.data?.message || err?.message || String(err));
}

async function load(){
  if(loading) return loading;
  loading = (async () => {
    $("admin-rows").innerHTML = `<div class="empty">Loading&hellip;</div>`;
    try{
      const [users, sites] = await Promise.all([
        pb.collection("users").getFullList({ sort: "name", requestKey: null }),
        pb.collection("sites").getFullList({ sort: "sort", requestKey: null }),
      ]);
      USERS.splice(0, USERS.length, ...users);
      SITES.splice(0, SITES.length, ...sites);
      loaded = true;
      render(); updateCount();
    }catch(err){
      console.error(err);
      $("admin-rows").innerHTML = `<div class="empty">Could not load the Admin page (${esc(reason(err))}).</div>`;
    }finally{ loading = null; }
  })();
  return loading;
}

/* ------------------------------- the list ------------------------------- */
function group(id, name, count, colour, rows){
  const open = !!ui.q || openGroups.has(id);
  return `<section class="gsec"><div class="grouphead" data-group="${id}" aria-expanded="${open}"
    style="--gink:${colour.ink};--gtint:${colour.tint}">
    <div class="gname">${CHEV}${esc(name)} <span class="gcount">${count}</span></div></div>
    ${open ? `<div class="gcard">${rows}</div>` : ""}</section>`;
}

function render(){
  if(!loaded){ countText = ""; return; }
  const q = ui.q, hit = text => !q || text.toLowerCase().includes(q);
  const people = USERS.filter(u => hit([u.name, u.email, roleName(u.role)].join(" ")));
  const sites = SITES.filter(s => hit([s.name, s.full_name].join(" ")));

  const whereTheyWork = u => u.role === "admin" ? "All sites" : (u.sites || []).map(siteName).filter(Boolean).join(", ") || "No sites";
  const personRows = people.map(u => `<div class="row item lined" data-user="${u.id}" tabindex="0">
      <div class="name"><span class="ititle">${esc(u.name || "(no name)")}</span></div>
      <div class="rdata" data-kind="account">
        <span class="rd">${esc(roleName(u.role))}</span>
        <span class="rd">${esc(whereTheyWork(u))}</span>
        <span class="rd calc">${u.home_site ? `Staff at ${esc(siteName(u.home_site))}` : "Not on a Staff page"}</span>
        <span class="rd calc">${esc(u.email)}</span>
      </div></div>`).join("") + (q ? "" : `<div class="addrow additem" data-add-user>Add account</div>`);
  const siteRows = sites.map(s => `<div class="row item lined" data-site="${s.id}" tabindex="0">
      <div class="name"><span class="ititle">${esc(s.name)}</span></div>
      <div class="rdata" data-kind="site">
        <span class="rd calc">${esc(s.full_name || "")}</span>
        <span class="rd calc">${s.ref_prefix ? `Numbers start ${esc(s.ref_prefix)}` : "No number prefix"}</span>
      </div></div>`).join("");

  $("admin-rows").innerHTML = (people.length || !q ? group("accounts", "Accounts", plural(people.length, "account"), PALETTE[0], personRows) : "") +
    (sites.length ? group("sites", "Sites", plural(sites.length, "site"), PALETTE[1], siteRows) : "") ||
    `<div class="empty">Nothing matches that filter.</div>`;
  countText = `${plural(people.length, "account")}, ${plural(sites.length, "site")}`;
  lineUp($("admin-rows"));
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const syncToggleLabel = () => { $("collapse-all").textContent = openGroups.size ? "Collapse all" : "Expand all"; };

function onClick(e){
  const g = e.target.closest("[data-group]");
  if(g){
    const id = g.dataset.group;
    openGroups.has(id) ? openGroups.delete(id) : openGroups.add(id);
    syncToggleLabel(); render();
    return;
  }
  if(e.target.closest("[data-add-user]")) return openAccount(null);
  const row = e.target.closest("[data-user],[data-site]");
  if(!row) return;
  if(row.dataset.user) openAccount(USERS.find(u => u.id === row.dataset.user));
  else openSite(SITES.find(s => s.id === row.dataset.site));
}

/* ------------------------------- an account ------------------------------- */
// u is null for a new account.
function openAccount(u){
  let dirty = false, changed = false;
  openItem({
    pill: u ? { text: roleName(u.role), bg: PALETTE[0].tint, fg: PALETTE[0].ink } : null,
    title: u ? u.name || u.email : "New account",
    sub: u ? u.email : "They sign in with this email and password",
    tabs: ["account"], start: "account",
    fill: { account: body => fillAccount(body, u, () => { dirty = true; }, () => { dirty = false; changed = true; }) },
    canClose: async () => {
      if(dirty && !await ask("Close without saving?", { ok: "Close", danger: true })) return false;
      if(changed) refreshBoard();
      return true;
    },
  });
}

function fillAccount(body, u, touched, saved){
  const self = u?.id === me();
  const holds = id => (u?.sites || []).includes(id);
  body.innerHTML = `<form class="admf" novalidate>
    <div class="fblock"><label class="flabel" for="ad-name">Name</label>
      <p class="fhelp">The board shows this, not the email.</p>
      <input class="ed" id="ad-name" maxlength="255" value="${esc(u?.name || "")}"></div>
    <div class="fblock"><label class="flabel" for="ad-email">Email</label>
      <input class="ed" id="ad-email" type="email" autocomplete="off" value="${esc(u?.email || "")}"></div>
    <div class="fblock"><label class="flabel" for="ad-role">Role</label>
      <p class="fhelp">${self ? "You can't change your own role." : "Admins change anything, on every site. Editors change their own sites. Viewers only look."}</p>
      <select class="ed" id="ad-role"${self ? " disabled" : ""}>${
        ROLES.map(([v, n]) => `<option value="${v}"${v === (u?.role || "viewer") ? " selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="fblock" id="ad-sitesblock"><span class="flabel">Sites</span>
      <p class="fhelp">The sites they can see.</p>
      <div class="ticks">${SITES.map(s => `<label><input type="checkbox" data-sid="${s.id}"${holds(s.id) ? " checked" : ""}> ${esc(s.name)}</label>`).join("")}</div></div>
    <div class="fblock"><label class="flabel" for="ad-home">Staff page</label>
      <p class="fhelp">The one site whose Staff page and Rota they're on.</p>
      <select class="ed" id="ad-home"><option value="">None</option>${
        SITES.map(s => `<option value="${s.id}"${s.id === u?.home_site ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
    <div class="fblock"><label class="flabel" for="ad-pw">${u ? "New password" : "Password"}</label>
      <p class="fhelp">${u ? "Leave empty to keep the current one. " : ""}At least 8 characters. There's no reset email yet, so tell them yourself.</p>
      <input class="ed" id="ad-pw" type="password" autocomplete="new-password"></div>
    <div class="line">
      <button type="submit" class="sbtn primary" id="ad-save">${u ? "Save" : "Add account"}</button>
      ${u && !self ? `<button type="button" class="sbtn link danger" id="ad-del">Delete account</button>` : ""}
      <span class="fstatus" id="ad-status" role="status"></span>
    </div>
  </form>`;
  const f = body.querySelector("form"), get = sel => body.querySelector(sel);
  const showSites = () => { get("#ad-sitesblock").hidden = get("#ad-role").value === "admin"; };
  showSites();
  f.addEventListener("input", () => { touched(); get("#ad-status").textContent = ""; showSites(); });

  f.addEventListener("submit", async e => {
    e.preventDefault();
    const name = get("#ad-name").value.trim(), email = get("#ad-email").value.trim(), password = get("#ad-pw").value;
    if(!name || !email || (!u && !password)){ get("#ad-status").textContent = `Fill in the name, email${u ? "" : " and password"}.`; return; }
    const data = { name, email, role: get("#ad-role").value, home_site: get("#ad-home").value,
      sites: [...body.querySelectorAll("[data-sid]:checked")].map(c => c.dataset.sid) };
    if(self) delete data.role;
    if(data.role === "admin") data.sites = [];         // admins hold every site
    if(password){ data.password = password; data.passwordConfirm = password; }
    get("#ad-save").disabled = true;
    try{
      if(u){
        const rec = await pb.collection("users").update(u.id, data);
        USERS.splice(USERS.indexOf(u), 1, rec);
      }else{
        USERS.push(await pb.collection("users").create({ ...data, verified: true }));
        USERS.sort((a, b) => a.name.localeCompare(b.name));
      }
    }catch(err){
      get("#ad-save").disabled = false;
      get("#ad-status").textContent = reason(err);
      return;
    }
    saved(); render(); updateCount();
    // Your own email or password changing ends your sign-in.
    if(self && (password || email !== u.email)){
      await tell("Your sign-in details have changed, so please sign in again.");
      pb.authStore.clear();
      location.reload();
      return;
    }
    closeItem();
  });

  get("#ad-del")?.addEventListener("click", async () => {
    if(!await ask(`Delete ${u.name || u.email}? Their leave is deleted too, and they come off any sessions. Their notes stay, under their name.`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection("users").delete(u.id); }
    catch(err){ get("#ad-status").textContent = reason(err); return; }
    USERS.splice(USERS.indexOf(u), 1);
    saved(); render(); updateCount();
    closeItem();
  });
}

/* --------------------------------- a site --------------------------------- */
function openSite(s){
  let dirty = false, changed = false;
  const didChange = () => { changed = true; };
  openItem({
    pill: { text: s.name, bg: siteTint(s), fg: siteColour(s) },
    title: s.full_name || s.name, sub: "Site details, rooms and departments",
    tabs: ["site", "rooms", "departments"], start: "site",
    fill: {
      site: body => fillSite(body, s, () => { dirty = true; }, () => { dirty = false; changed = true; }),
      rooms: (body, isCurrent) => fillList(body, isCurrent, s, "rooms", "room", didChange,
        "Each room is a row on the Timetable. Renaming one updates its sessions. One with sessions can't be deleted."),
      departments: (body, isCurrent) => fillList(body, isCurrent, s, "departments", "department", didChange,
        "The list on each course. Courses sort in this order. Renaming one updates its courses. One with courses can't be deleted."),
    },
    canClose: async () => {
      if(dirty && !await ask("Close without saving?", { ok: "Close", danger: true })) return false;
      if(changed) refreshBoard();
      return true;
    },
  });
}

function fillSite(body, s, touched, saved){
  const on = s.views || [];
  body.innerHTML = `<form class="admf" novalidate>
    <div class="fblock"><label class="flabel" for="ad-sname">Name</label>
      <p class="fhelp">In the Site dropdown, and the banner if it has no logo.</p>
      <input class="ed" id="ad-sname" maxlength="100" value="${esc(s.name)}"></div>
    <div class="fblock"><label class="flabel" for="ad-sfull">Full name</label>
      <p class="fhelp">Under the name in the banner, and on its PDFs.</p>
      <input class="ed" id="ad-sfull" maxlength="100" value="${esc(s.full_name || "")}"></div>
    <div class="fblock"><span class="flabel">Link code</span>
      <p class="fhelp"><b>${esc(s.code)}</b> - can't be changed here, as links already shared use it.</p></div>
    <div class="fblock"><label class="flabel" for="ad-scol">Colour</label>
      <input class="ed swatch" id="ad-scol" type="color" value="${esc(s.colour || DEFAULT_COLOUR)}"></div>
    <div class="fblock"><span class="flabel">Banner</span>
      <div class="ticks"><label><input type="checkbox" id="ad-slogo"${s.logo ? " checked" : ""}> Show the logo image, not the name</label></div></div>
    <div class="fblock"><label class="flabel" for="ad-spre">Quote and invoice prefix</label>
      <p class="fhelp">Goes in front of new numbers, e.g. CSSC-. Numbers already issued keep theirs.</p>
      <input class="ed" id="ad-spre" maxlength="20" value="${esc(s.ref_prefix || "")}"></div>
    <div class="fblock"><label class="flabel" for="ad-ssort">Order</label>
      <p class="fhelp">Lower numbers come first in the Site dropdown.</p>
      <input class="ed" id="ad-ssort" type="number" step="1" value="${esc(s.sort ?? 0)}"></div>
    <div class="fblock"><span class="flabel">Pages</span>
      <p class="fhelp">Which pages this site has. None ticked means all of them.</p>
      <div class="ticks">${VIEWS.map(([v, n]) => `<label><input type="checkbox" data-view="${v}"${on.includes(v) ? " checked" : ""}> ${n}</label>`).join("")}</div></div>
    <div class="line">
      <button type="submit" class="sbtn primary" id="ad-ssave">Save</button>
      <span class="fstatus" id="ad-sstatus" role="status"></span>
    </div>
  </form>`;
  const f = body.querySelector("form"), get = sel => body.querySelector(sel);
  f.addEventListener("input", () => { touched(); get("#ad-sstatus").textContent = ""; });
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const name = get("#ad-sname").value.trim();
    if(!name){ get("#ad-sstatus").textContent = "Give the site a name."; return; }
    const known = VIEWS.map(v => v[0]);
    const data = { name, full_name: get("#ad-sfull").value.trim(), colour: get("#ad-scol").value, logo: get("#ad-slogo").checked,
      ref_prefix: get("#ad-spre").value.trim(), sort: Number(get("#ad-ssort").value) || 0,
      // Anything ticked that this form doesn't list stays as it is.
      views: [...on.filter(v => !known.includes(v)), ...[...body.querySelectorAll("[data-view]:checked")].map(c => c.dataset.view)] };
    get("#ad-ssave").disabled = true;
    try{
      Object.assign(s, await pb.collection("sites").update(s.id, data));
      SITES.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }catch(err){
      get("#ad-ssave").disabled = false;
      get("#ad-sstatus").textContent = reason(err);
      return;
    }
    saved(); render();
    get("#ad-ssave").disabled = false;
    get("#ad-sstatus").textContent = "Saved.";
  });
}

/* A site's rooms or departments: rename in place, arrows to reorder, x to
   delete, a box to add. Each change saves on its own. */
async function fillList(body, isCurrent, s, collection, noun, didChange, help){
  body.innerHTML = `<p class="loading">Loading&hellip;</p>`;
  let items = [];
  try{ items = await pb.collection(collection).getFullList({ sort: "sort,name", filter: pb.filter("site = {:s}", { s: s.id }), requestKey: null }); }
  catch(err){ if(isCurrent()) body.innerHTML = `<p class="loading">${esc(reason(err))}</p>`; return; }
  if(!isCurrent()) return;

  body.innerHTML = `<div class="admf">
    <p class="fhelp">${esc(help)}</p>
    <div class="lrows"></div>
    <form class="ladd"><input class="ed" maxlength="100" placeholder="Add a ${noun}" aria-label="Add a ${noun}">
      <button type="submit" class="sbtn">Add</button></form>
    <span class="fstatus" role="status"></span>
  </div>`;
  const rows = body.querySelector(".lrows"), status = body.querySelector(".fstatus");

  function draw(){
    rows.innerHTML = items.map((x, i) => `<div class="lrow" data-id="${x.id}">
      <input class="ed" maxlength="100" value="${esc(x.name)}" aria-label="${esc(noun)} name">
      <button type="button" class="ibtn" data-move="-1" aria-label="Move ${esc(x.name)} up" title="Move up"${i ? "" : " disabled"}>&uarr;</button>
      <button type="button" class="ibtn" data-move="1" aria-label="Move ${esc(x.name)} down" title="Move down"${i < items.length - 1 ? "" : " disabled"}>&darr;</button>
      <button type="button" class="ibtn danger" data-del aria-label="Delete ${esc(x.name)}" title="Delete">&times;</button>
    </div>`).join("") || `<p class="fhelp">None yet.</p>`;
  }
  draw();

  rows.onchange = async e => {
    const x = items.find(i => i.id === e.target.closest(".lrow")?.dataset.id);
    if(!x) return;
    const name = e.target.value.trim();
    status.textContent = "";
    if(!name || name === x.name){ e.target.value = x.name; return; }
    try{ x.name = (await pb.collection(collection).update(x.id, { name })).name; didChange(); status.textContent = "Saved."; }
    catch(err){ e.target.value = x.name; status.textContent = reason(err); }
  };

  rows.onclick = async e => {
    const btn = e.target.closest("button");
    const x = btn && items.find(i => i.id === btn.closest(".lrow").dataset.id);
    if(!x) return;
    status.textContent = "";
    if(btn.dataset.move){
      const from = items.indexOf(x);
      items.splice(from, 1);
      items.splice(from + Number(btn.dataset.move), 0, x);
      draw();
      try{
        // Their place in the list becomes their sort, for any that differ.
        for(const [i, it] of items.entries()) if(it.sort !== i){ await pb.collection(collection).update(it.id, { sort: i }, { requestKey: null }); it.sort = i; }
        didChange();
      }catch(err){ status.textContent = reason(err); }
      return;
    }
    if(!await ask(`Delete ${x.name}?`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection(collection).delete(x.id); }
    catch(err){ status.textContent = reason(err); return; }
    items.splice(items.indexOf(x), 1);
    didChange(); draw();
  };

  body.querySelector(".ladd").onsubmit = async e => {
    e.preventDefault();
    const input = e.target.querySelector("input"), name = input.value.trim();
    if(!name) return;
    status.textContent = "";
    try{
      items.push(await pb.collection(collection).create({ name, site: s.id, sort: items.length ? Math.max(...items.map(i => i.sort || 0)) + 1 : 0 }));
      input.value = "";
      didChange(); draw();
    }catch(err){ status.textContent = reason(err); }
  };
}

function forget(){ loaded = false; loading = null; countText = ""; USERS.length = 0; SITES.length = 0; }

export default {
  id: ID,
  label: "Admin",
  requires: "admin",
  toolbar: { filter: "Filter accounts, sites", expandAll: true, edit: false },
  init(){
    const pane = $(ID);
    pane.addEventListener("click", onClick);
    pane.addEventListener("keydown", e => {
      if(e.key === "Enter" && e.target.matches("[data-user],[data-site]")) onClick(e);
    });
  },
  render,
  async show(){
    syncToggleLabel();
    if(!loaded) await load();
  },
  count: () => countText,
  toggleAll(){
    if(openGroups.size) openGroups.clear();
    else ["accounts", "sites"].forEach(id => openGroups.add(id));
    syncToggleLabel(); render();
  },
  // Not about the site on show; refreshBoard() lands here too, and what's
  // on this page is already up to date.
  periodChanged(){},
  siteChanged(){},
  reset(){ forget(); openGroups.clear(); $("admin-rows").innerHTML = ""; },
};
