/* Forms view (#pane-forms): categories -> form sets -> forms, laid out like
   Courses (groups -> courses -> sessions) with the shared grouped-list look
   (.glist, .row.item / .row.sub in base.css). Data: pb_migrations/
   1735000019_forms.js; the public side: pb_hooks/forms.pb.js, form.html.

   - A category is a coloured header; a form set (e.g. "Foundation") is an
     item row, clicked to show its forms; a form is a sub-item row, clicked
     to open the item pop-up (views/sheet.js) with three tabs:
       Preview    the public form page itself, in a frame (?preview=1, so
                  it can't submit), with its link, Copy link, Open/Close
       Questions  the editor: the form's settings and its questions;
                  changes apply on Save (unsaved changes are asked about
                  before the pop-up closes)
       Responses  the financial year's responses (core/period.js) as a
                  table, Download CSV, delete one (admins)
   - Edit mode (admins): add/rename/recolour/delete categories, add/rename/
     delete form sets and forms, duplicate a form.
   - Everyone signed in sees everything (responses included - the user's
     call); only admins change anything. The API rules enforce the same.

   Its data isn't shared, so it loads its own the first time it's shown,
   like Invoices. Response counts are for the financial year on show. */
import { pb } from "../core/pb.js";
import { canEdit as mayEdit, siteId, siteFilter, andSite } from "../core/site.js";
import { PALETTE } from "../core/data.js";
import { CHEV, esc, debounceSave } from "../core/util.js";
import { ui, updateCount, reportSaveError } from "../core/shell.js";
import { period, periodStamps } from "../core/period.js";
import { TYPES, DISPLAYS } from "../core/formrender.js";
import { openItem, refillTab } from "./sheet.js";
import { ask, tell } from "../core/dialog.js";
import { lineUp } from "../core/rowdetails.js";

const ID = "pane-forms";
const $ = id => document.getElementById(id);

const FG = [], FS = [], FF = [];   // categories, form sets, forms
const COUNTS = {};                 // form id -> { n, last } in the year on show
const openGroups = new Set(), openSets = new Set();   // expanded (collapsed by default)
let loaded = false, loading = null, gen = 0, countText = "";
let ED = null;                     // the question editor's draft: { id, form, dirty }

const clear = o => { for(const k of Object.keys(o)) delete o[k]; };
const setsOf = gid => FS.filter(s => s.group === gid);
const formsOf = sid => FF.filter(f => f.set === sid);
const countOf = id => COUNTS[id]?.n || 0;
const shortDay = iso => new Date(iso.replace(" ", "T")).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const stamp = iso => new Date(iso.replace(" ", "T")).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toISOString().slice(0, 10);
const isLive = f => f.open && !(f.closes && today() > f.closes);
// The public page sits beside index.html (GitHub Pages serves the board from a folder).
const linkOf = f => new URL(`form.html#${f.code}`, location.href).href;
const newId = () => "q" + Math.random().toString(36).slice(2, 8);
function status(f){
  if(!f.open) return "Closed";
  if(f.closes && today() > f.closes) return "Closed (date passed)";
  return f.closes ? "Open until " + shortDay(f.closes) : "Open";
}

/* -------------------------------- data ---------------------------------- */
async function load(){
  if(loading) return loading;
  const g = gen;
  loading = (async () => {
    $("form-rows").innerHTML = `<div class="empty">Loading&hellip;</div>`;
    try{
      const { from, to } = periodStamps();
      const [groups, sets, forms, responses] = await Promise.all([
        // The site on show (core/site.js) only.
        pb.collection("form_groups").getFullList({ sort: "sort", filter: siteFilter() }),
        pb.collection("form_sets").getFullList({ sort: "sort", filter: siteFilter() }),
        pb.collection("forms").getFullList({ sort: "sort", filter: siteFilter() }),
        pb.collection("form_responses").getFullList({ fields: "form,created",
          filter: andSite(pb.filter("created >= {:from} && created <= {:to}", { from, to })) }),
      ]);
      if(g !== gen) return;
      FG.splice(0, FG.length, ...groups);
      FS.splice(0, FS.length, ...sets);
      FF.splice(0, FF.length, ...forms);
      clear(COUNTS);
      responses.forEach(r => {
        const c = COUNTS[r.form] ||= { n: 0, last: "" };
        c.n++; if(r.created > c.last) c.last = r.created;
      });
      loaded = true;
      render(); updateCount();
    }catch(err){
      if(g !== gen) return;
      console.error(err);
      $("form-rows").innerHTML = `<div class="empty">Could not load forms (${esc(err.message || err)}).</div>`;
    }finally{ loading = null; }
  })();
  return loading;
}

/* ------------------------------- the list ------------------------------- */
function render(){
  if(!loaded){ countText = ""; return; }
  const q = ui.q, editing = ui.editing, filtering = !!q;
  let html = "", nSets = 0, nForms = 0;

  FG.forEach(g => {
    const sets = setsOf(g.id).map(s => {
      const all = formsOf(s.id);
      const setHit = !filtering || s.title.toLowerCase().includes(q);
      const forms = setHit ? all : all.filter(f => f.title.toLowerCase().includes(q));
      return { s, forms, show: setHit || forms.length };
    }).filter(x => x.show);
    if(!sets.length && !(editing && !filtering)) return;
    const formCount = sets.reduce((n, x) => n + x.forms.length, 0);
    nSets += sets.length; nForms += formCount;
    const gOpen = filtering || openGroups.has(g.id);

    html += `<section class="gsec"><div class="grouphead" data-fgroup="${g.id}" aria-expanded="${gOpen}"
      style="--gink:${esc(g.ink)};--gtint:${esc(g.tint)}">
      <div class="gname">${CHEV}${editing
        ? `<input class="ed gtitle" value="${esc(g.name)}" data-gid="${g.id}" data-gk="name" aria-label="Category name">
           <select class="ed gcol" data-gid="${g.id}" data-gk="colour" aria-label="Colour">${
             PALETTE.map(p => `<option value="${p.ink}"${p.ink === g.ink ? " selected" : ""}>${p.name}</option>`).join("")}</select>`
        : esc(g.name)}
        <span class="gcount">${sets.length} ${sets.length === 1 ? "set" : "sets"}, ${formCount} ${formCount === 1 ? "form" : "forms"}</span>
      </div>
      ${editing ? `<button class="delg ibtn danger" data-del="group:${g.id}" title="Delete category">&times;</button>` : ""}
    </div>`;
    if(!gOpen){ html += `</section>`; return; }
    html += `<div class="gcard">`;

    sets.forEach(({ s, forms }) => {
      const sOpen = filtering || openSets.has(s.id);
      const responses = forms.reduce((n, f) => n + countOf(f.id), 0);
      const exp = `<button type="button" class="exp" data-ftoggle="${s.id}" aria-expanded="${sOpen}"
            aria-label="${sOpen ? "Hide" : "Show"} forms">${CHEV}</button>`;
      const formsLabel = `${forms.length} ${forms.length === 1 ? "form" : "forms"}`;
      const respLabel = `${responses} ${responses === 1 ? "response" : "responses"}`;
      // View mode: title, then its details (counts) - css .lined/.rdata,
      // js/core/rowdetails.js. Edit mode keeps the field grid.
      html += editing
        ? `<div class="row item fset" data-fset="${s.id}">
            <div class="name">${exp}<input class="ed" value="${esc(s.title)}" data-sid="${s.id}" data-sk="title" aria-label="Form set name"></div>
            <div><span class="tag">${formsLabel}</span></div>
            <div><span class="tag">${respLabel}</span></div>
            <div></div>
            <button class="del ibtn danger" data-del="set:${s.id}" title="Delete form set">&times;</button>
          </div>`
        : `<div class="row item fset lined" data-fset="${s.id}" tabindex="0">
            <div class="name">${exp}<span class="ititle">${esc(s.title)}</span></div>
            <div class="rdata" data-kind="fset"><span class="rd calc">${formsLabel}</span><span class="rd calc">${respLabel}</span></div>
          </div>`;
      // Nothing under it (and nothing to add, outside edit mode): no empty card.
      if(!sOpen || (!forms.length && !editing)) return;
      html += `<div class="subs"><div class="subcard">`;
      forms.forEach(f => {
        const c = COUNTS[f.id];
        const formResp = `${c ? c.n : 0} ${c && c.n === 1 ? "response" : "responses"}`;
        html += editing
          ? `<div class="row sub fform" data-fopen="${f.id}">
              <div class="name"><input class="ed" value="${esc(f.title)}" data-fid="${f.id}" data-fk="title" aria-label="Form name"></div>
              <div class="muted"><span class="fstate${isLive(f) ? " live" : ""}">${esc(status(f))}</span></div>
              <div class="muted tnum">${formResp}</div>
              <div class="muted tnum"><button type="button" class="fdup sbtn link sm" data-fdup="${f.id}">Duplicate</button></div>
              <button class="del ibtn danger" data-del="form:${f.id}" title="Delete form">&times;</button>
            </div>`
          : `<div class="row sub fform lined" data-fopen="${f.id}" tabindex="0">
              <div class="name"><span class="ititle">${esc(f.title)}</span></div>
              <div class="rdata" data-kind="fform">
                <span class="rd calc">${formResp}</span>
                <span class="rd${isLive(f) ? " ok" : ""}">${esc(status(f))}</span>
                <span class="rd">${c ? "Last " + esc(shortDay(c.last)) : "&nbsp;"}</span>
              </div>
            </div>`;
      });
      if(editing) html += `<div class="addrow addsub" data-fadd-form="${s.id}">Add form</div>`;
      html += `</div></div>`;
    });
    if(editing && !filtering) html += `<div class="addrow additem" data-fadd-set="${g.id}">Add form set</div>`;
    html += `</div></section>`;
  });

  if(editing && !filtering) html += `<div class="addrow addgroup" data-fadd-group>Add category</div>`;
  $("form-rows").innerHTML = html || `<div class="empty">${filtering
    ? "Nothing matches that filter."
    : mayEdit() ? "No forms yet. Click Edit, then Add category, to start." : "No forms yet."}</div>`;
  countText = `${nSets} form ${nSets === 1 ? "set" : "sets"}, ${nForms} ${nForms === 1 ? "form" : "forms"}`;
  lineUp($("form-rows"));
}

/* --------------------------- list edits (admins) ------------------------- */
async function save(collection, id, patch){
  try{ return await pb.collection(collection).update(id, patch); }
  catch(err){ reportSaveError(err); return null; }
}

function onInput(e){
  const t = e.target;
  if(t.dataset.gk === "name"){
    const g = FG.find(x => x.id === t.dataset.gid); if(!g) return;
    g.name = t.value;
    debounceSave("form_groups:" + g.id, () => save("form_groups", g.id, { name: g.name.trim() || "Untitled" }));
  } else if(t.dataset.sk === "title"){
    const s = FS.find(x => x.id === t.dataset.sid); if(!s) return;
    s.title = t.value;
    debounceSave("form_sets:" + s.id, () => save("form_sets", s.id, { title: s.title.trim() || "Untitled" }));
  } else if(t.dataset.fk === "title"){
    const f = FF.find(x => x.id === t.dataset.fid); if(!f) return;
    f.title = t.value;
    debounceSave("forms:" + f.id, () => save("forms", f.id, { title: f.title.trim() || "Untitled" }));
  }
}

async function onChange(e){
  const t = e.target;
  if(t.dataset.gk !== "colour") return;
  const g = FG.find(x => x.id === t.dataset.gid);
  const p = PALETTE.find(p => p.ink === t.value);
  if(!g || !p) return;
  g.ink = p.ink; g.tint = p.tint; render();
  await save("form_groups", g.id, { ink: p.ink, tint: p.tint });
}

async function create(collection, data){
  try{ return await pb.collection(collection).create(data); }
  catch(err){ reportSaveError(err); return null; }
}

async function remove(kind, id){
  if(kind === "group"){
    const g = FG.find(x => x.id === id); if(!g) return;
    const forms = setsOf(id).flatMap(s => formsOf(s.id));
    if(!await ask(forms.length
      ? `Delete the category "${g.name}", its ${forms.length} ${forms.length === 1 ? "form" : "forms"} and all their responses? This can't be undone.`
      : `Delete the category "${g.name}"?`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection("form_groups").delete(id); }catch(err){ reportSaveError(err); return; }
  } else if(kind === "set"){
    const s = FS.find(x => x.id === id); if(!s) return;
    const n = formsOf(id).length;
    if(!await ask(n ? `Delete "${s.title}", its ${n} ${n === 1 ? "form" : "forms"} and all their responses? This can't be undone.`
      : `Delete "${s.title}"?`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection("form_sets").delete(id); }catch(err){ reportSaveError(err); return; }
  } else {
    const f = FF.find(x => x.id === id); if(!f) return;
    const n = await totalResponses(id);
    if(!await ask(n ? `Delete the form "${f.title}" and its ${n} ${n === 1 ? "response" : "responses"}? This can't be undone.`
      : `Delete the form "${f.title}"?`, { ok: "Delete", danger: true })) return;
    try{ await pb.collection("forms").delete(id); }catch(err){ reportSaveError(err); return; }
  }
  await load();   // cascades: simplest to re-read
}

// Responses across every year (COUNTS is only the year on show).
async function totalResponses(formId){
  try{ return (await pb.collection("form_responses").getList(1, 1, { filter: pb.filter("form = {:f}", { f: formId }), fields: "id" })).totalItems; }
  catch{ return 0; }
}

const BLANK_SETTINGS = { intro: "", submitLabel: "", thanks: "", anonymous: false };

async function onClick(e){
  if(e.target.closest("input,select")) return;
  const t = e.target;

  const del = t.closest("[data-del]");
  if(del){ const [kind, id] = del.dataset.del.split(":"); return remove(kind, id); }

  if(t.closest("[data-fadd-group]")){
    const used = new Set(FG.map(g => g.ink));
    const p = PALETTE.find(p => !used.has(p.ink)) || PALETTE[0];
    // Filed under the site on show; sets, forms and responses inside it take
    // its site on the server (pb_hooks/sites.pb.js).
    const rec = await create("form_groups", { site: siteId(), name: "New category", ink: p.ink, tint: p.tint, sort: FG.length });
    if(rec){ FG.push(rec); openGroups.add(rec.id); render(); updateCount(); }
    return;
  }
  const addSet = t.closest("[data-fadd-set]");
  if(addSet){
    const rec = await create("form_sets", { group: addSet.dataset.faddSet, title: "New form set", sort: FS.length });
    if(rec){ FS.push(rec); openSets.add(rec.id); render(); updateCount(); }
    return;
  }
  const addForm = t.closest("[data-fadd-form]");
  if(addForm){
    const rec = await create("forms", { set: addForm.dataset.faddForm, title: "New form", sort: FF.length,
      open: false, closes: "", settings: BLANK_SETTINGS, questions: [] });
    if(rec){ FF.push(rec); render(); updateCount(); openForm(rec.id, "questions"); }
    return;
  }
  const dup = t.closest("[data-fdup]");
  if(dup){
    const f = FF.find(x => x.id === dup.dataset.fdup); if(!f) return;
    const rec = await create("forms", { set: f.set, title: f.title + " (copy)", sort: FF.length,
      open: false, closes: "", settings: f.settings || BLANK_SETTINGS, questions: f.questions || [] });
    if(rec){ FF.push(rec); render(); updateCount(); }
    return;
  }

  const tog = t.closest("[data-ftoggle]") || (!ui.editing && t.closest("[data-fset]"));
  if(tog){
    const id = tog.dataset.ftoggle || tog.dataset.fset;
    openSets.has(id) ? openSets.delete(id) : openSets.add(id);
    syncToggleLabel(); render();
    $("form-rows").querySelector(`[data-ftoggle="${id}"]`)?.focus({ preventScroll: true });
    return;
  }
  const row = t.closest("[data-fopen]");
  if(row && !ui.editing){ openForm(row.dataset.fopen); return; }

  const g = t.closest("[data-fgroup]");
  if(g){
    const id = g.dataset.fgroup;
    openGroups.has(id) ? openGroups.delete(id) : openGroups.add(id);
    syncToggleLabel(); render();
  }
}

const syncToggleLabel = () => { $("collapse-all").textContent = (openGroups.size || openSets.size) ? "Collapse all" : "Expand all"; };
function toggleAll(){
  if(openGroups.size || openSets.size){ openGroups.clear(); openSets.clear(); }
  else { FG.forEach(g => openGroups.add(g.id)); FS.forEach(s => openSets.add(s.id)); }
  syncToggleLabel(); render();
}

/* ------------------------------- the pop-up ------------------------------ */
function openForm(id, start = "preview"){
  const f = FF.find(x => x.id === id); if(!f) return;
  const s = FS.find(x => x.id === f.set), g = s && FG.find(x => x.id === s.group);
  ED = null;
  openItem({
    pill: g ? { text: g.name, bg: g.tint, fg: g.ink } : null,
    title: f.title, sub: s ? s.title : "",
    tabs: ["preview", "questions", "responses"], start,
    counts: { questions: (f.questions || []).filter(q => q.type !== "info").length || "", responses: countOf(id) || "" },
    fill: {
      preview: body => fillPreview(id, body),
      questions: body => fillEditor(id, body),
      responses: (body, isCurrent) => fillResponses(id, body, isCurrent),
    },
    canClose: async () => !ED || !ED.dirty
      || await ask("Discard your unsaved changes to this form?", { ok: "Discard", danger: true }),
  });
}

// ---- QR codes: vendored qrcode-generator, loaded the first time ----
let qrLoading = null;
function loadQR(){
  if(window.qrcode) return Promise.resolve(window.qrcode);
  if(!qrLoading) qrLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/vendor/qrcode-generator.min.js";
    s.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error("The QR tool did not load"));
    s.onerror = () => { qrLoading = null; reject(new Error("Could not load the QR tool")); };
    document.head.appendChild(s);
  });
  return qrLoading;
}
async function qrFor(text){
  const qrcode = await loadQR();
  const qr = qrcode(0, "M");   // smallest size that fits; medium error correction
  qr.addData(text); qr.make();
  return qr;
}
// A PNG for printing on posters and slides: black on white, a 4-module quiet zone.
function qrPNG(qr, title){
  const n = qr.getModuleCount(), scale = 12, quiet = 4, size = (n + quiet * 2) * scale;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, size, size);
  g.fillStyle = "#000";
  for(let y = 0; y < n; y++) for(let x = 0; x < n; x++)
    if(qr.isDark(y, x)) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  c.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, "-")} - QR code.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

// ---- Preview: the public page in a frame ----
function fillPreview(id, body){
  const f = FF.find(x => x.id === id); if(!f) return;
  const admin = mayEdit();
  body.innerHTML = `<div class="fpbar">
      <span class="fstate${isLive(f) ? " live" : ""}">${esc(status(f))}</span>
      <input class="flink ed" readonly value="${esc(linkOf(f))}" aria-label="Form link">
      <button type="button" class="sbtn" data-fp="copy">Copy link</button>
      <button type="button" class="sbtn" data-fp="qr" aria-expanded="false">QR code</button>
      ${admin ? `<button type="button" class="sbtn" data-fp="toggle">${f.open ? "Close form" : "Open form"}</button>` : ""}
    </div>
    <div class="fqr" hidden></div>
    <iframe class="fpframe" src="form.html?preview=1#${encodeURIComponent(f.code)}" title="Preview of ${esc(f.title)}"></iframe>`;
  body.onclick = async e => {
    const b = e.target.closest("[data-fp]"); if(!b) return;
    if(b.dataset.fp === "copy"){
      try{ await navigator.clipboard.writeText(linkOf(f)); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy link"; }, 2000); }
      catch{ body.querySelector(".flink").select(); }
    } else if(b.dataset.fp === "qr"){
      // Shows the link's QR code above the preview, with a PNG download.
      const box = body.querySelector(".fqr");
      if(!box.hidden){ box.hidden = true; b.setAttribute("aria-expanded", "false"); return; }
      try{
        const qr = await qrFor(linkOf(f));
        box.innerHTML = `<div class="fqrimg">${qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true, alt: "QR code for " + f.title })}</div>
          <div class="fqrtext"><strong>QR code for this form</strong><span>Opens ${esc(linkOf(f))}</span>
          <button type="button" class="sbtn" data-fp="qrpng">Download PNG</button></div>`;
        box.hidden = false; b.setAttribute("aria-expanded", "true");
        box.querySelector('[data-fp="qrpng"]').onclick = () => qrPNG(qr, f.title);
      }catch(err){ tell("Couldn't make the QR code: " + (err.message || err)); }
    } else if(b.dataset.fp === "toggle"){
      const rec = await save("forms", f.id, { open: !f.open });
      if(rec){ Object.assign(f, rec); if(ED) ED.form.open = rec.open; render(); fillPreview(id, body); if(ED) redrawEditor(); }
    }
  };
}

// ---- Questions: the editor ----
function fillEditor(id, body){
  const f = FF.find(x => x.id === id); if(!f) return;
  ED = { id, body, dirty: false, form: {
    title: f.title, open: !!f.open, closes: f.closes || "",
    settings: { ...BLANK_SETTINGS, ...(f.settings || {}) },
    questions: JSON.parse(JSON.stringify(f.questions || [])),
  } };
  redrawEditor();
  body.oninput = onEditorInput;
  body.onchange = onEditorChange;
  body.onclick = onEditorClick;
}

function redrawEditor(){
  const { form: d, body } = ED, admin = mayEdit(), dis = admin ? "" : " disabled";
  const field = (label, html, cls = "") => `<label class="fef${cls}"><span>${esc(label)}</span>${html}</label>`;
  const qs = d.questions;
  body.innerHTML = `<div class="fed${admin ? "" : " readonly"}">
    ${admin ? "" : `<p class="fenote">Only admins can change forms.</p>`}
    <section class="fesec fecard">
      <h3>Form settings</h3>
      <div class="fegrid">
        ${field("Title", `<input class="ed" data-e="title" value="${esc(d.title)}"${dis}>`, " wide")}
        ${field("Introduction", `<textarea class="ed" data-e="intro" rows="3"${dis}>${esc(d.settings.intro)}</textarea>`, " wide")}
        ${field("Submit button", `<input class="ed" data-e="submitLabel" value="${esc(d.settings.submitLabel)}" placeholder="Submit"${dis}>`)}
        ${field("Closes on (optional)", `<input class="ed" type="date" data-e="closes" value="${esc(d.closes)}"${dis}>`)}
        ${field("Thank-you message", `<textarea class="ed" data-e="thanks" rows="2" placeholder="Thank you - your response has been sent."${dis}>${esc(d.settings.thanks)}</textarea>`, " wide")}
      </div>
      <div class="fechecks">
        <label class="fecheck"><input type="checkbox" data-e="open"${d.open ? " checked" : ""}${dis}> Open for responses</label>
        <label class="fecheck"><input type="checkbox" data-e="anonymous"${d.settings.anonymous ? " checked" : ""}${dis}> Anonymous (don't ask for names or emails)</label>
      </div>
    </section>
    <section class="fesec">
      <h3>Questions <span class="fecount">${qs.filter(q => q.type !== "info").length}</span></h3>
      ${qs.length ? qs.map((q, i) => questionCard(q, i, qs, admin)).join("") : `<p class="fenote">No questions yet.</p>`}
      ${admin ? `<div class="feadd"><select class="ed" data-e="newtype" aria-label="Kind of question">${
        Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
        <button type="button" class="sbtn primary" data-e="add">Add question</button></div>` : ""}
    </section>
  </div>
  ${admin ? `<div class="fefoot"><span class="festatus">${ED.dirty ? "Unsaved changes" : ""}</span>
    <button type="button" class="sbtn" data-e="discard"${ED.dirty ? "" : " disabled"}>Discard</button>
    <button type="button" class="sbtn primary" data-e="save"${ED.dirty ? "" : " disabled"}>Save</button></div>` : ""}`;
}

function questionCard(q, i, qs, admin){
  const dis = admin ? "" : " disabled";
  const earlier = qs.slice(0, i).filter(x => x.type === "choice" && (x.options || []).length);
  const src = q.showIf && earlier.find(x => x.id === q.showIf.q);
  return `<div class="fq${q.type === "info" ? " info" : ""}" data-i="${i}">
    <div class="fqhead">
      <span class="fqn">${i + 1}</span>
      <select class="ed" data-qk="type" aria-label="Kind of question"${dis}>${Object.entries(TYPES).map(([k, v]) =>
        `<option value="${k}"${k === q.type ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
      ${q.type === "info" ? "" : `<label class="fecheck"><input type="checkbox" data-qk="required"${q.required ? " checked" : ""}${dis}> Required</label>`}
      <span class="fqspacer"></span>
      ${admin ? `<button type="button" class="ibtn" data-qmove="-1" title="Move up" aria-label="Move up"${i ? "" : " disabled"}>&uarr;</button>
        <button type="button" class="ibtn" data-qmove="1" title="Move down" aria-label="Move down"${i < qs.length - 1 ? "" : " disabled"}>&darr;</button>
        <button type="button" class="ibtn danger" data-qdel title="Delete question" aria-label="Delete question">&times;</button>` : ""}
    </div>
    <div class="fqbody">
    <label class="fef"><span>${q.type === "info" ? "Heading" : q.type === "yesno" ? "Statement to tick" : "Question"}</span>
      <input class="ed fqlabel" data-qk="label" value="${esc(q.label || "")}" placeholder="${q.type === "info" ? "e.g. About you" : q.type === "yesno" ? "e.g. I agree to my details being kept" : "e.g. What is your current role?"}"${dis}></label>
    <label class="fef"><span>${q.type === "info" ? "Text" : "Help text"} <em>(optional)</em></span>
      <textarea class="ed" data-qk="help" rows="1"${dis}>${esc(q.help || "")}</textarea></label>
    ${q.type === "choice" ? `<div class="fqrow">
      <label class="fef fqopts"><span>Answers <em>(one per line)</em></span>
        <textarea class="ed" data-qk="options" rows="${Math.min(Math.max((q.options || []).length, 2), 8)}"${dis}>${esc((q.options || []).join("\n"))}</textarea></label>
      <label class="fef"><span>Shown as</span><select class="ed" data-qk="display"${dis}>${Object.entries(DISPLAYS).map(([k, v]) =>
        `<option value="${k}"${k === (q.display || "dropdown") ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
    </div>` : ""}
    ${earlier.length ? `<div class="fef"><span>Show this ${q.type === "info" ? "heading" : "question"}</span><div class="fqrow fqshow">
      <select class="ed" data-qk="showIfQ"${dis}><option value="">always</option>${earlier.map(x =>
        `<option value="${esc(x.id)}"${src && src.id === x.id ? " selected" : ""}>only if "${esc((x.label || "Untitled").slice(0, 50))}" is</option>`).join("")}</select>
      ${src ? `<select class="ed" data-qk="showIfV"${dis}>${(src.options || []).map(o =>
        `<option${o === q.showIf.value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>` : ""}
    </div></div>` : ""}
    </div>
  </div>`;
}

function markDirty(){
  if(!ED.dirty){
    ED.dirty = true;
    const foot = ED.body.querySelector(".fefoot");
    if(foot){ foot.querySelector(".festatus").textContent = "Unsaved changes"; foot.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
  }
}

// Typing: update the draft without redrawing (that would move the cursor).
function onEditorInput(e){
  if(!ED || !mayEdit()) return;
  const t = e.target, d = ED.form;
  const k = t.dataset.e;
  if(k === "title") d.title = t.value;
  else if(k === "intro" || k === "submitLabel" || k === "thanks") d.settings[k] = t.value;
  else if(k === "closes") d.closes = t.value;
  else if(t.dataset.qk === "label" || t.dataset.qk === "help"){
    d.questions[Number(t.closest("[data-i]").dataset.i)][t.dataset.qk] = t.value;
  } else if(t.dataset.qk === "options"){
    d.questions[Number(t.closest("[data-i]").dataset.i)].options = t.value.split("\n").map(x => x.trim()).filter(Boolean);
  } else return;
  markDirty();
}

// Choices that change the form's shape: update and redraw.
function onEditorChange(e){
  if(!ED || !mayEdit()) return;
  const t = e.target, d = ED.form;
  if(t.dataset.e === "open") d.open = t.checked;
  else if(t.dataset.e === "anonymous") d.settings.anonymous = t.checked;
  else if(t.dataset.qk){
    const q = d.questions[Number(t.closest("[data-i]").dataset.i)];
    const k = t.dataset.qk;
    if(k === "type"){
      q.type = t.value;
      if(q.type === "choice"){ q.options ||= []; q.display ||= "dropdown"; }
      if(q.type === "info") delete q.required;
    }
    else if(k === "required") q.required = t.checked;
    else if(k === "display") q.display = t.value;
    else if(k === "options"){ redrawEditor(); return; }   // already read on input; redraw "show if" lists
    else if(k === "showIfQ"){
      const src = d.questions.find(x => x.id === t.value);
      if(src) q.showIf = { q: src.id, value: (src.options || [])[0] || "" }; else delete q.showIf;
    }
    else if(k === "showIfV" && q.showIf) q.showIf.value = t.value;
    else return;
  } else return;
  markDirty(); redrawEditor();
}

async function onEditorClick(e){
  if(!ED || !mayEdit()) return;
  const t = e.target, d = ED.form;
  if(t.closest('[data-e="add"]')){
    const type = ED.body.querySelector('[data-e="newtype"]').value;
    const q = { id: newId(), type, label: "", help: "" };
    if(type !== "info") q.required = false;
    if(type === "choice"){ q.options = []; q.display = "dropdown"; }
    d.questions.push(q);
    markDirty(); redrawEditor();
    ED.body.querySelector(`[data-i="${d.questions.length - 1}"] .fqlabel`)?.focus();
    return;
  }
  const card = t.closest("[data-i]");
  if(card && t.closest("[data-qmove]")){
    const i = Number(card.dataset.i), j = i + Number(t.closest("[data-qmove]").dataset.qmove);
    if(j < 0 || j >= d.questions.length) return;
    [d.questions[i], d.questions[j]] = [d.questions[j], d.questions[i]];
    tidyShowIf(d.questions); markDirty(); redrawEditor();
    return;
  }
  if(card && t.closest("[data-qdel]")){
    d.questions.splice(Number(card.dataset.i), 1);
    tidyShowIf(d.questions); markDirty(); redrawEditor();
    return;
  }
  if(t.closest('[data-e="discard"]')){
    if(!await ask("Discard your unsaved changes to this form?", { ok: "Discard", danger: true })) return;
    fillEditor(ED.id, ED.body);
    return;
  }
  if(t.closest('[data-e="save"]')) saveEditor();
}

// A "show if" must point to an earlier choice question and one of its answers.
function tidyShowIf(qs){
  qs.forEach((q, i) => {
    if(!q.showIf) return;
    const src = qs.slice(0, i).find(x => x.id === q.showIf.q && x.type === "choice");
    if(!src || !(src.options || []).includes(q.showIf.value)) delete q.showIf;
  });
}

async function saveEditor(){
  const d = ED.form;
  tidyShowIf(d.questions);
  const problems = [];
  if(!d.title.trim()) problems.push("The form needs a title.");
  d.questions.forEach((q, i) => {
    if(!(q.label || "").trim()) problems.push(`Question ${i + 1} needs ${q.type === "info" ? "a heading" : "its wording"}.`);
    if(q.type === "choice" && (q.options || []).length < 2) problems.push(`Question ${i + 1} needs at least two answers to choose from.`);
  });
  if(problems.length){ await tell(problems.join("\n")); return; }

  const f = FF.find(x => x.id === ED.id);
  // Removing or changing questions on a form people have answered: old
  // responses keep the wording they were given, but say so.
  const before = new Map((f.questions || []).map(q => [q.id, q.type]));
  const changed = [...before].some(([id, type]) => { const q = d.questions.find(x => x.id === id); return !q || q.type !== type; });
  if(changed){
    const n = await totalResponses(f.id);
    if(n && !await ask(`${n} ${n === 1 ? "person has" : "people have"} already answered this form. Removing or changing the kind of a question doesn't change their answers - they keep the questions they were asked. Save anyway?`, { ok: "Save" })) return;
  }
  const rec = await save("forms", f.id, { title: d.title.trim(), open: d.open, closes: d.closes, settings: d.settings, questions: d.questions });
  if(!rec) return;
  Object.assign(f, rec);
  ED.dirty = false;
  redrawEditor(); render();
  $("sheet-title").textContent = f.title;
  const qc = document.querySelector('#sheet-tab-questions .fcount');
  if(qc) qc.textContent = (f.questions || []).filter(q => q.type !== "info").length || "";
  refillTab("preview");
}

// ---- Responses ----
async function fillResponses(id, body, isCurrent){
  const f = FF.find(x => x.id === id); if(!f) return;
  body.innerHTML = `<p class="fenote">Loading responses&hellip;</p>`;
  const { from, to } = periodStamps();
  let rows;
  try{
    rows = await pb.collection("form_responses").getFullList({ sort: "-created",
      filter: pb.filter("form = {:f} && created >= {:from} && created <= {:to}", { f: id, from, to }) });
  }catch(err){ if(isCurrent()) body.innerHTML = `<p class="fenote">Could not load responses (${esc(err.message || err)}).</p>`; return; }
  if(!isCurrent()) return;
  drawResponses(f, rows, body, isCurrent);
}

function responseColumns(f, rows){
  // Each column gets a fixed width for its kind of answer (css: .frtable
  // .w-*), so a row opened to its full answers still lines up under the
  // headings: long text wide, short text medium, the rest narrow.
  const width = t => t === "long" ? "long" : t === "text" || t === "email" ? "text" : "short";
  const cols = (f.questions || []).filter(q => q.type !== "info")
    .map(q => ({ id: q.id, label: q.label || "Untitled", w: width(q.type) }));
  const known = new Set(cols.map(c => c.id));
  // Answers to questions since removed: still shown, labelled as they were asked.
  rows.forEach(r => Object.keys(r.answers || {}).forEach(k => {
    if(!known.has(k)){ known.add(k); cols.push({ id: k, label: ((r.labels || {})[k] || k) + " (removed)", w: "text" }); }
  }));
  return cols;
}
const cell = v => v === true ? "Yes" : v === false ? "No" : v === undefined || v === null ? "" : String(v);

function drawResponses(f, rows, body, isCurrent){
  const admin = mayEdit(), cols = responseColumns(f, rows);
  body.innerHTML = `<div class="frbar">
      <span class="frcount">${rows.length} ${rows.length === 1 ? "response" : "responses"} in ${esc(period.label)}</span>
      ${rows.length ? `<button type="button" class="sbtn" data-fr="csv">Download CSV</button>` : ""}
    </div>
    ${rows.length ? `<div class="frwrap"><table class="frtable">
      <thead><tr><th class="w-when"><span>Submitted</span></th>${cols.map(c => `<th class="w-${c.w}" title="${esc(c.label)}"><span>${esc(c.label)}</span></th>`).join("")}${admin ? '<th class="w-del"></th>' : ""}</tr></thead>
      <tbody>${rows.map(r => `<tr data-rid="${r.id}" title="Click to show the full answers"><td class="tnum w-when">${esc(stamp(r.created))}</td>${cols.map(c => {
        const v = cell((r.answers || {})[c.id]);
        return `<td class="w-${c.w}">${esc(v)}</td>`;
      }).join("")}${admin
        ? `<td><button type="button" class="ibtn danger" data-fr-del="${r.id}" title="Delete response" aria-label="Delete response">&times;</button></td>` : ""}</tr>`).join("")}</tbody>
    </table></div>` : `<p class="fenote">No responses in ${esc(period.label)} yet.</p>`}`;
  body.onclick = async e => {
    if(e.target.closest('[data-fr="csv"]')) return downloadCSV(f, rows, cols);
    // A row opens in place to show its answers in full, each still in its
    // own column; clicking it again closes it.
    const tr = e.target.closest("tbody tr");
    if(tr && !e.target.closest("[data-fr-del]")){ tr.classList.toggle("open"); return; }
    const del = e.target.closest("[data-fr-del]");
    if(del){
      if(!await ask("Delete this response? This can't be undone.", { ok: "Delete", danger: true })) return;
      try{ await pb.collection("form_responses").delete(del.dataset.frDel); }catch(err){ reportSaveError(err); return; }
      const i = rows.findIndex(r => r.id === del.dataset.frDel);
      if(i !== -1) rows.splice(i, 1);
      if(COUNTS[f.id]) COUNTS[f.id].n = Math.max(COUNTS[f.id].n - 1, 0);
      render();
      const rc = document.querySelector('#sheet-tab-responses .fcount');
      if(rc) rc.textContent = countOf(f.id) || "";
      if(isCurrent()) drawResponses(f, rows, body, isCurrent);
    }
  };
}

function downloadCSV(f, rows, cols){
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Submitted", ...cols.map(c => c.label)].map(q).join(",")]
    .concat(rows.map(r => [r.created, ...cols.map(c => cell((r.answers || {})[c.id]))].map(q).join(",")));
  // BOM so Excel reads it as UTF-8.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${f.title.replace(/[\\/:*?"<>|]+/g, "-")} - responses ${period.label.replace("/", "-")}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default {
  id: ID,
  label: "Forms",
  toolbar: { filter: "Filter forms", expandAll: true },
  init(){
    const pane = $(ID);
    pane.addEventListener("click", onClick);
    pane.addEventListener("input", onInput);
    pane.addEventListener("change", onChange);
    pane.addEventListener("keydown", e => {
      if((e.key === "Enter" || e.key === " ") && e.target.matches(".row[tabindex]")){ e.preventDefault(); e.target.click(); }
    });
  },
  async show(){
    syncToggleLabel();
    if(!loaded){ await load(); }
  },
  render,
  count: () => countText,
  toggleAll,
  // Another year: response counts change; the next show() reloads.
  periodChanged(){ gen++; loaded = false; loading = null; countText = ""; clear(COUNTS); },
  // Another site: drop all of the old one's forms; the next show() loads.
  siteChanged(){
    gen++; ED = null;
    FG.length = 0; FS.length = 0; FF.length = 0; clear(COUNTS);
    openGroups.clear(); openSets.clear();
    loaded = false; loading = null; countText = "";
    $("form-rows").innerHTML = "";
  },
  reset(){
    gen++; ED = null;
    FG.length = 0; FS.length = 0; FF.length = 0; clear(COUNTS);
    openGroups.clear(); openSets.clear();
    loaded = false; loading = null; countText = "";
    $("form-rows").innerHTML = "";
  },
};
