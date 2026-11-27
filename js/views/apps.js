/* Apps view (#pane-apps, the user's design 2026-10-14): a grid of cards -
   image, title, description - each opening another tool in a new tab.
   Each app says which sites and which kinds of account see it, and the
   server only sends what's for you. This page shows the ones for the site
   on show, and the top bar's filter narrows them by title or description.

   Edit mode (admins, and editors on their own sites - 2026-11-27): an
   "Add app" card, and a card click opens it in the item pop-up instead of
   following its link - title, description, link, picture, who sees it,
   which sites, order. An app on several sites can only be changed by
   someone who can write to all of them (the database holds the same line,
   supabase/migrations/20261127000000_apps_editing.sql); anyone else sees
   it read-only. Apps hidden from your role but yours to change show only
   in edit mode, marked as hidden. */
import { pb } from "../core/pb.js";
import { esc } from "../core/util.js";
import { ui, updateCount } from "../core/shell.js";
import { site, siteColour, siteById, canEdit } from "../core/site.js";
import { ask, tell } from "../core/dialog.js";
import { openItem, closeItem } from "./sheet.js";
import { PALETTE } from "../core/data.js";

const ID = "pane-apps";
const $ = id => document.getElementById(id);
const APPS = [];
let loaded = false, loading = null, gen = 0, countText = "";

const ROLES = [["admin", "Admins"], ["editor", "Editors"], ["viewer", "Viewers"]];

// Only ever a web link (a typo mustn't make a card run script).
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
const host = u => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };

const me = () => pb.authStore.record || {};
// Matches app.can_write_all(): admin, or an editor holding every site it's on.
const mayChange = a => me().role === "admin" ||
  (me().role === "editor" && a.sites.length > 0 && a.sites.every(s => (me().sites || []).includes(s)));
const forMyRole = a => a.roles.includes(me().role);
// The sites someone may put an app on.
const writableSites = () => me().role === "admin" ? site.list.filter(s => !s.all)
  : site.list.filter(s => !s.all && (me().sites || []).includes(s.id));

async function load(){
  if(loading) return loading;
  const g = gen;
  loading = (async () => {
    $("app-cards").innerHTML = `<div class="empty">Loading&hellip;</div>`;
    try{
      const recs = await pb.collection("apps").getFullList({ sort: "sort,title", requestKey: null,
        filter: pb.filter("sites.id ?= {:s}", { s: site.current?.id || "" }) });
      if(g !== gen) return;
      const urls = await pb.files.signedURLs(recs.map(r => r.image));
      if(g !== gen) return;
      APPS.splice(0, APPS.length, ...recs.map(r => ({
        id: r.id, title: r.title, description: r.description || "", url: safeUrl(r.url), rawUrl: r.url || "",
        imageName: String(r.image || "").replace(/^\/+/, ""), sites: r.sites || [], roles: r.roles || [], sort: r.sort || 0,
        image: urls[String(r.image || "").replace(/^\/+/, "")] || "",
      })));
      loaded = true;
      render(); updateCount();
    }catch(err){
      if(g !== gen) return;
      console.error(err);
      $("app-cards").innerHTML = `<div class="empty">Could not load apps (${esc(err.message || err)}).</div>`;
    }finally{ loading = null; }
  })();
  return loading;
}

function render(){
  if(!loaded){ countText = ""; return; }
  const q = ui.q;
  const shown = APPS.filter(a => !q || (a.title + " " + a.description).toLowerCase().includes(q));
  // No image: a tile with the app's first letter in the site's colour.
  const tint = siteColour(site.current);
  const add = canEdit() && !q ? `<button type="button" class="appcard appadd" data-add>
      <span class="appaddplus" aria-hidden="true">+</span><span>Add app</span></button>` : "";
  const cards = shown.map(a => `
    <a class="appcard${forMyRole(a) ? "" : " offrole"}" data-id="${esc(a.id)}"${a.url ? ` href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"` : ""}>
      <div class="appimg"${a.image ? "" : ` style="--app:${esc(tint)}"`}>${a.image
        ? `<img src="${esc(a.image)}" alt="" loading="lazy">`
        : `<span>${esc(a.title.trim().charAt(0).toUpperCase())}</span>`}</div>
      <div class="appbody">
        <h3>${esc(a.title)}</h3>
        ${a.description ? `<p>${esc(a.description)}</p>` : ""}
        ${a.url ? `<span class="apphost">${esc(host(a.url))}</span>` : ""}
        ${forMyRole(a) ? "" : `<span class="appnote">Hidden from ${esc(roleWord(me().role))}</span>`}
      </div>
    </a>`).join("");
  // The message shows when nothing is for your role; edit mode may still
  // show hidden apps and the Add card under it.
  const none = shown.some(forMyRole) ? "" : `<div class="empty">${q ? "No apps match that filter." : "No apps for this site yet."}</div>`;
  $("app-cards").innerHTML = none + (cards || add ? `<div class="appgrid">${cards}${add}</div>` : "");
  const n = shown.filter(forMyRole).length;
  countText = `${n} app${n === 1 ? "" : "s"}`;
}
const roleWord = r => (ROLES.find(x => x[0] === r) || [r, r + "s"])[1].toLowerCase();

/* -------------------------------- editing -------------------------------- */

function onClick(e){
  if(!ui.editing) return;                       // outside edit mode a card is just a link
  if(e.target.closest("[data-add]")){ e.preventDefault(); return openApp(null); }
  const card = e.target.closest("[data-id]");
  if(!card) return;
  e.preventDefault();
  openApp(APPS.find(a => a.id === card.dataset.id));
}

// a is null for a new app.
function openApp(a){
  let dirty = false, changed = false;
  openItem({
    pill: { text: a ? "App" : "New app", bg: PALETTE[0].tint, fg: PALETTE[0].ink },
    title: a ? a.title : "New app", sub: a ? (host(a.url) || "No link") : `On ${site.current?.name || "this site"}`,
    tabs: ["app"], start: "app",
    fill: { app: body => fillApp(body, a, () => { dirty = true; }, () => { dirty = false; changed = true; }) },
    canClose: async () => {
      if(dirty && !await ask("Close without saving?", { ok: "Close", danger: true })) return false;
      if(changed){ forget(); load(); }
      return true;
    },
  });
}

function fillApp(body, a, touched, saved){
  const editable = !a || mayChange(a);
  const sites = writableSites();
  const onSites = a ? a.sites : [site.current?.id].filter(Boolean);
  const roles = a ? a.roles : ROLES.map(r => r[0]);
  const others = a ? a.sites.filter(id => !sites.some(s => s.id === id)) : [];
  const dis = editable ? "" : " disabled";
  body.innerHTML = `<form class="admf" novalidate>
    ${editable ? "" : `<p class="fhelp">This app is also on ${esc(others.map(id => siteById(id)?.name || "another site").join(", ") || "another site")},
      so only an admin can change it.</p>`}
    <div class="fblock"><label class="flabel" for="ap-title">Title</label>
      <input class="ed" id="ap-title" maxlength="80" value="${esc(a?.title || "")}"${dis}></div>
    <div class="fblock"><label class="flabel" for="ap-desc">Description</label>
      <p class="fhelp">A line or two under the title. Up to 300 characters.</p>
      <textarea class="ed" id="ap-desc" maxlength="300" rows="3"${dis}>${esc(a?.description || "")}</textarea></div>
    <div class="fblock"><label class="flabel" for="ap-url">Link</label>
      <p class="fhelp">Where the card goes - a full web address starting https://.</p>
      <input class="ed" id="ap-url" type="url" maxlength="2000" placeholder="https://" value="${esc(a?.rawUrl || "")}"${dis}></div>
    <div class="fblock"><span class="flabel">Picture</span>
      <p class="fhelp">Shown 16:9 at the top of the card. PNG, JPEG or WebP, up to 5 MB. Without one, the card shows the title's first letter.</p>
      <div class="appedimg">
        <div class="appimg" id="ap-preview"${a?.image ? "" : ` style="--app:${esc(siteColour(site.current))}"`}>${a?.image
          ? `<img src="${esc(a.image)}" alt="">` : `<span>${esc((a?.title || "?").trim().charAt(0).toUpperCase())}</span>`}</div>
        ${editable ? `<div class="line">
          <label class="sbtn">Choose picture<input type="file" id="ap-file" accept="image/png,image/jpeg,image/webp" hidden></label>
          ${a?.imageName ? `<button type="button" class="sbtn link" id="ap-noimg">Remove picture</button>` : ""}
        </div>` : ""}
      </div></div>
    <div class="fblock"><span class="flabel">Who sees it</span>
      <div class="ticks">${ROLES.map(([v, n]) => `<label><input type="checkbox" data-role="${v}"${roles.includes(v) ? " checked" : ""}${dis}> ${n}</label>`).join("")}</div></div>
    <div class="fblock"><span class="flabel">Sites</span>
      <p class="fhelp">The sites it's on.${me().role === "admin" ? "" : " You can only choose sites you edit."}</p>
      <div class="ticks">${sites.map(s => `<label><input type="checkbox" data-site="${esc(s.id)}"${onSites.includes(s.id) ? " checked" : ""}${dis}> ${esc(s.name)}</label>`).join("")}</div></div>
    <div class="fblock"><label class="flabel" for="ap-sort">Order</label>
      <p class="fhelp">Lower numbers come first.</p>
      <input class="ed" id="ap-sort" type="number" step="1" style="max-width:120px" value="${esc(a?.sort ?? nextSort())}"${dis}></div>
    ${editable ? `<div class="line">
      <button type="submit" class="sbtn primary" id="ap-save">${a ? "Save" : "Add app"}</button>
      ${a ? `<button type="button" class="sbtn link danger" id="ap-del">Delete app</button>` : ""}
      <span class="fstatus" id="ap-status" role="status"></span>
    </div>` : ""}
  </form>`;
  if(!editable) return;

  const f = body.querySelector("form"), get = sel => body.querySelector(sel);
  const status = t => { get("#ap-status").textContent = t; };
  let file = null, removeImage = false;
  f.addEventListener("input", () => { touched(); status(""); });

  get("#ap-file").addEventListener("change", e => {
    file = e.target.files[0] || null;
    if(!file) return;
    removeImage = false;
    get("#ap-preview").removeAttribute("style");
    get("#ap-preview").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
    touched();
  });
  get("#ap-noimg")?.addEventListener("click", () => {
    file = null; removeImage = true;
    get("#ap-preview").style.setProperty("--app", siteColour(site.current));
    get("#ap-preview").innerHTML = `<span>${esc((get("#ap-title").value || "?").trim().charAt(0).toUpperCase())}</span>`;
    touched();
  });

  f.addEventListener("submit", async e => {
    e.preventDefault();
    const title = get("#ap-title").value.trim(), url = get("#ap-url").value.trim();
    const chosenRoles = [...body.querySelectorAll("[data-role]:checked")].map(c => c.dataset.role);
    // Sites this person can't choose stay as they were.
    const chosenSites = [...others, ...[...body.querySelectorAll("[data-site]:checked")].map(c => c.dataset.site)];
    if(!title) return status("Give the app a title.");
    if(!/^https?:\/\/\S+$/i.test(url)) return status("The link needs to be a full web address, starting https://.");
    if(!chosenRoles.length) return status("Tick who sees it.");
    if(!chosenSites.length) return status("Tick at least one site.");
    const data = { title, description: get("#ap-desc").value.trim(), url, roles: chosenRoles, sites: chosenSites,
      sort: Number(get("#ap-sort").value) || 0 };
    get("#ap-save").disabled = true;
    try{
      if(file){ status("Uploading the picture…"); data.image = await pb.files.uploadAppImage(file); }
      else if(removeImage) data.image = "";
      if(a) await pb.collection("apps").update(a.id, data);
      else await pb.collection("apps").create(data);
    }catch(err){
      get("#ap-save").disabled = false;
      return status(err?.message || String(err));
    }
    saved();
    closeItem();
  });

  get("#ap-del")?.addEventListener("click", async () => {
    const where = a.sites.length > 1 ? ` It's on ${a.sites.length} sites and goes from all of them.` : "";
    if(!await ask(`Delete ${a.title}?${where}`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection("apps").delete(a.id); }
    catch(err){ return status(err?.message || String(err)); }
    saved();
    closeItem();
  });
}
const nextSort = () => APPS.length ? Math.max(...APPS.map(a => a.sort)) + 1 : 0;

function forget(){ gen++; loaded = false; loading = null; countText = ""; APPS.length = 0; }

export default {
  id: ID,
  label: "Apps",
  toolbar: { filter: "Filter apps" },
  init(){
    $(ID).addEventListener("click", onClick);
    $(ID).addEventListener("keydown", e => {
      if(ui.editing && e.key === "Enter" && e.target.matches("[data-id]")) onClick(e);
    });
  },
  render,
  async show(){ if(!loaded) await load(); },
  count: () => countText,
  periodChanged(){ /* apps aren't by year */ },
  siteChanged(){ forget(); },
  reset(){ forget(); $("app-cards").innerHTML = ""; },
};
