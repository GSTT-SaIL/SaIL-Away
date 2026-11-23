/* Apps view (#pane-apps, the user's design 2026-10-14): a grid of cards -
   image, title, description - each opening another tool in a new tab.
   Apps are added in the dashboard (pb_migrations/1735000032_apps.js); each
   says which sites and which kinds of account see it, and the server only
   sends what's for you. This page shows the ones for the site on show, and
   the top bar's filter narrows them by title or description. */
import { pb } from "../core/pb.js";
import { esc } from "../core/util.js";
import { ui, updateCount } from "../core/shell.js";
import { site, siteColour } from "../core/site.js";

const ID = "pane-apps";
const $ = id => document.getElementById(id);
const APPS = [];
let loaded = false, loading = null, gen = 0, countText = "";

// Only ever a web link (a dashboard typo mustn't make a card run script).
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
const host = u => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };

async function load(){
  if(loading) return loading;
  const g = gen;
  loading = (async () => {
    $("app-cards").innerHTML = `<div class="empty">Loading&hellip;</div>`;
    try{
      const recs = await pb.collection("apps").getFullList({ sort: "sort,title", requestKey: null,
        filter: pb.filter("sites.id ?= {:s}", { s: site.current?.id || "" }) });
      if(g !== gen) return;
      APPS.splice(0, APPS.length, ...recs.map(r => ({
        id: r.id, title: r.title, description: r.description || "", url: safeUrl(r.url),
        image: r.image ? pb.files.getURL(r, r.image, { thumb: "640x360" }) : "",
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
  $("app-cards").innerHTML = shown.length ? `<div class="appgrid">${shown.map(a => `
    <a class="appcard"${a.url ? ` href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"` : ""}>
      <div class="appimg"${a.image ? "" : ` style="--app:${esc(tint)}"`}>${a.image
        ? `<img src="${esc(a.image)}" alt="" loading="lazy">`
        : `<span>${esc(a.title.trim().charAt(0).toUpperCase())}</span>`}</div>
      <div class="appbody">
        <h3>${esc(a.title)}</h3>
        ${a.description ? `<p>${esc(a.description)}</p>` : ""}
        ${a.url ? `<span class="apphost">${esc(host(a.url))}</span>` : ""}
      </div>
    </a>`).join("")}</div>`
    : `<div class="empty">${q ? "No apps match that filter." : "No apps for this site yet. Add them in the dashboard (apps)."}</div>`;
  countText = `${shown.length} app${shown.length === 1 ? "" : "s"}`;
}

function forget(){ gen++; loaded = false; loading = null; countText = ""; APPS.length = 0; }

export default {
  id: ID,
  label: "Apps",
  toolbar: { filter: "Filter apps" },
  render,
  async show(){ if(!loaded) await load(); },
  count: () => countText,
  periodChanged(){ /* apps aren't by year */ },
  siteChanged(){ forget(); },
  reset(){ forget(); $("app-cards").innerHTML = ""; },
};
