/* The detail sheet (#backdrop in index.html): the standard pop-up for one
   item. A header (group pill, title, subtitle, Close) over a row of
   filing tabs, one per function relevant to the item. Any view opens it
   with openItem() (below), describing its item; openSession() /
   openCourse() are the Courses/Timetable ones. Registered with the shell
   only so that sign-out closes it.

   Adding a tab: a button in .ftabs and a matching .fpanel (same data-tab)
   in index.html - for a tab a view fills itself, give the panel an empty
   .fbody and pass a fill function to openItem(). Items list the tabs they
   show; showTabs() hides the rest.

   Notes: several per session or course, each with a title and its author,
   in the "session_notes"/"course_notes" collections. A list on the left
   (newest first), the selected note on the right. The server stamps the
   author (pb_hooks/*_notes.pb.js). Admins write them; viewers see them
   read-only (like everything else in the app - the collections' API rules
   enforce it, this just doesn't offer the editor). */
import { pb } from "../core/pb.js";
import { canEdit as mayEdit } from "../core/site.js";
import { BOOKINGS, G, NOTES, COURSE_NOTES, COURSES, findCourse, noteFrom, rebuildBookings } from "../core/data.js";
import { esc, longDate, parseISO, sanitizeHtml, debounceSave, MON } from "../core/util.js";
import { reportSaveError, rerender } from "../core/shell.js";
import { ask } from "../core/dialog.js";

const $ = id => document.getElementById(id);

let lastFocus = null;
let currentItem = null;   // { type: "session"|"course", id } - whose notes are showing
let currentNoteId = null; // the selected note

// ---------- tabs ----------

// Show only the listed tabs, in their markup order, and select `start`.
function showTabs(ids, start){
  document.querySelectorAll("#backdrop .ftab").forEach(t=>{ t.hidden = !ids.includes(t.dataset.tab); });
  selectTab(ids.includes(start) ? start : ids[0]);
}

function selectTab(id, focus = false){
  document.querySelectorAll("#backdrop .ftab").forEach(t=>{
    const on = t.dataset.tab === id;
    t.classList.toggle("on", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;               // roving tabindex: Tab enters the tab row at the open tab
    if(on && focus) t.focus();
  });
  document.querySelectorAll("#backdrop .fpanel").forEach(p=>{ p.hidden = p.dataset.tab !== id; });
  if(fillers[id] && !filled.has(id)){ filled.add(id); fillers[id](); }
}

function visibleTabs(){
  return [...document.querySelectorAll("#backdrop .ftab")].filter(t=>!t.hidden);
}

// ---------- opening an item ----------

/* Opens the pop-up for any kind of item. Views describe the item; the
   sheet draws it, so every item pop-up looks and behaves the same.
     pill    { text, bg, fg } - the coloured label above the title (optional)
     title, sub
     details [label, html][] - the Details tab's rows; html is trusted, so
             the caller escapes anything that came from data
     action  { label, href, external } - the Details tab's button (optional)
     tabs    tab ids to show, in their markup order (e.g. ["details","notes"])
     start   the tab to open on
     notes   { type: "session"|"course", id } - for the Notes tab
     counts  { tabId: number } - shown beside a tab's name
     fill    { tabId: (panelBody, isCurrent) => void } - fills a tab the first
             time it's opened (lazy loading); isCurrent() turns false once
             the pop-up closes or shows another item, so a slow load can
             check it before drawing.
     canClose  async () => boolean - asked before the pop-up closes by Close,
             Escape or a click outside; false keeps it open (e.g. unsaved
             edits the user wants to keep). */
let openSeq = 0;
let fillers = {}, filled = new Set();
let closeGuard = null, closing = false;

export function openItem({ pill, title, sub = "", details = [], action, tabs, start = "details",
                           notes, counts = {}, fill = {}, canClose = null }){
  closeGuard = canClose;
  if(!$("backdrop").classList.contains("open")) lastFocus = document.activeElement;
  const seq = ++openSeq;
  const p = $("sheet-pill");
  p.hidden = !pill;
  p.textContent = pill ? pill.text : "";
  p.style.background = pill ? pill.bg : "";
  p.style.color = pill ? pill.fg : "";
  $("sheet-title").textContent = title;
  $("sheet-sub").textContent = sub;
  $("sheet-body").innerHTML = details.map(([label, html])=>`<dt>${esc(label)}</dt><dd>${html}</dd>`).join("");

  const btn = $("sheet-action");
  btn.hidden = !action;
  if(action){
    btn.textContent = action.label;
    btn.href = action.href;
    if(action.external){ btn.target = "_blank"; btn.rel = "noopener noreferrer"; }
    else { btn.removeAttribute("target"); btn.removeAttribute("rel"); }
  }

  document.querySelectorAll("#backdrop .ftab .fcount").forEach(c=>{
    const id = c.closest(".ftab").dataset.tab;
    if(id !== "notes") c.textContent = counts[id] ?? "";
  });

  currentItem = null; currentNoteId = null;
  if(notes) openNotes(notes);

  fillers = {};
  filled = new Set();
  Object.entries(fill).forEach(([tab, fn])=>{
    const body = document.querySelector(`#backdrop .fpanel[data-tab="${tab}"] .fbody`);
    body.innerHTML = "";
    fillers[tab] = () => fn(body, () => seq === openSeq && $("backdrop").classList.contains("open"));
  });

  showTabs(tabs, start);
  $("backdrop").classList.add("open");
  $("sheet-close").focus();
}

// Group colours as the pill, as the Courses list and Timetable show them.
const groupPill = g => g ? { text: g.name, bg: g.tint, fg: g.ink } : null;
const mailLink = e => `<a href="mailto:${esc(e)}">${esc(e)}</a>`;

export function openSession(id, start = "details"){
  const b = BOOKINGS.find(x=>x.id===id);
  if(!b) return;
  openItem({
    pill: groupPill(G[b.group]), title: b.title, sub: b.courseTitle,
    details: [
      ["Room", esc(b.room)],
      ["Date", esc(longDate(parseISO(b.date)))],
      ["Time", `<span class="tnum">${esc(b.start)} to ${esc(b.end)}</span>`],
      ["Lead", esc(b.lead)],
      ["Email", mailLink(b.email)],
    ],
    tabs: ["details", "allocate", "notes"], start, notes: { type:"session", id },
    counts: { allocate: b.staff?.length || "" },
    fill: { allocate: (body, isCurrent) => fillAllocate(body, isCurrent, b) },
  });
}

/* ---------- Allocate (a session's staff) ----------
   The user's design, 2026-10-09: pick any number of the session's site's
   staff (accounts with that home site, read through the `staff` view -
   names only). A search box with a dropdown of matches; the allocated list
   under it, each with a remove button. Admins and the site's editors
   change it (the session's own rules); everyone else sees the list. The
   Rota shows each allocation on that person's row. The server only accepts
   people from the session's site (pb_hooks/session_staff.pb.js). */
async function fillAllocate(body, isCurrent, b){
  const s = COURSES.flatMap(c => c.sessions).find(x => x.id === b.id);
  if(!s) return;
  const edit = mayEdit();
  body.innerHTML = `<p class="loading">Loading staff&hellip;</p>`;
  let people = [];
  try{
    people = await pb.collection("staff").getFullList({ sort: "name", filter: pb.filter("site = {:s}", { s: b.site }), requestKey: null });
  }catch(err){
    if(isCurrent()) body.innerHTML = `<p class="loading">Could not load staff (${esc(err.message || err)}).</p>`;
    return;
  }
  if(!isCurrent()) return;
  const nameOf = id => people.find(p => p.id === id)?.name;

  function draw(){
    const mine = s.staff || [];
    body.innerHTML = `<div class="alloc">
      ${edit ? `<div class="allocadd">
        <input class="ed" type="search" id="alloc-q" placeholder="Add staff - type a name" autocomplete="off" aria-label="Add staff">
        <div class="allocsugg" id="alloc-sugg" role="listbox" hidden></div>
      </div>` : ""}
      ${mine.length ? `<ul class="alloclist">${mine.map(id => `<li>
          <span>${esc(nameOf(id) || "Someone no longer on this site")}</span>
          ${edit ? `<button type="button" class="ibtn danger" data-unalloc="${esc(id)}" title="Remove" aria-label="Remove ${esc(nameOf(id) || "")}">&times;</button>` : ""}
        </li>`).join("")}</ul>`
        : `<p class="allocnone">No one allocated yet.</p>`}
      ${!people.length ? `<p class="allocnone">This site has no staff yet - give people a home site on the Admin page.</p>` : ""}
    </div>`;
    const c = $("sheet-tab-allocate").querySelector(".fcount");
    if(c) c.textContent = mine.length || "";
    if(!edit) return;

    const q = body.querySelector("#alloc-q"), sugg = body.querySelector("#alloc-sugg");
    const matches = () => {
      const t = q.value.trim().toLowerCase();
      return people.filter(p => !mine.includes(p.id) && (!t || p.name.toLowerCase().includes(t)));
    };
    const showSugg = () => {
      const m = matches();
      sugg.innerHTML = m.length
        ? m.map(p => `<button type="button" role="option" data-alloc="${esc(p.id)}">${esc(p.name)}</button>`).join("")
        : `<div class="allocnone">${people.length ? "No one else matches" : "No staff on this site"}</div>`;
      sugg.hidden = false;
    };
    q.addEventListener("focus", showSugg);
    q.addEventListener("input", showSugg);
    q.addEventListener("keydown", e => {
      if(e.key === "Enter"){ e.preventDefault(); const m = matches(); if(m.length) change("+", m[0].id); }
      // Close the dropdown, not the pop-up.
      else if(e.key === "Escape" && !sugg.hidden){ e.preventDefault(); e.stopPropagation(); sugg.hidden = true; }
    });
    q.addEventListener("blur", () => setTimeout(() => { sugg.hidden = true; }, 150));
    sugg.addEventListener("mousedown", e => e.preventDefault());   // keep focus in the box while picking
  }

  async function change(op, id){
    try{
      const rec = await pb.collection("sessions").update(s.id, { ["staff" + op]: id });
      s.staff = rec.staff || [];
    }catch(err){ reportSaveError(err); return; }
    rebuildBookings();
    rerender();                      // the Rota shows allocations
    if(!isCurrent()) return;
    draw();
    if(op === "+") body.querySelector("#alloc-q")?.focus();
  }

  // Assigned, not added: the panel is reused for every session.
  body.onclick = e => {
    const add = e.target.closest("[data-alloc]");
    if(add){ change("+", add.dataset.alloc); return; }
    const rm = e.target.closest("[data-unalloc]");
    if(rm) change("-", rm.dataset.unalloc);
  };
  draw();
}

export function openCourse(id, start = "details"){
  const c = findCourse(id);
  if(!c) return;
  openItem({
    pill: groupPill(G[c.group]), title: c.title,
    sub: c.sessions.length+" session"+(c.sessions.length===1?"":"s"),
    details: [["Lead", esc(c.lead)], ["Email", mailLink(c.email)]],
    tabs: ["details", "notes"], start, notes: { type:"course", id },
  });
}

// force: sign-out - closes without asking the item's canClose().
async function close(refocus = true, force = false){
  if(!$("backdrop").classList.contains("open") || closing) return;
  if(!force && closeGuard){
    closing = true;
    try{ if(!await closeGuard()) return; }finally{ closing = false; }
  }
  $("backdrop").classList.remove("open");
  currentItem = null; currentNoteId = null;
  fillers = {}; filled = new Set(); closeGuard = null;
  if(refocus && lastFocus) lastFocus.focus();
}

// Re-run a tab's fill function (e.g. after the item changed), if it has one.
// Closes the pop-up from inside it (the item's canClose() is still asked).
export const closeItem = () => close();

export function refillTab(id){
  if(!fillers[id]) return;
  filled.add(id);
  fillers[id]();
}

// ---------- notes ----------

const storeFor = item => item.type === "course" ? COURSE_NOTES : NOTES;
const notesOf = item => storeFor(item)[item.id] || [];
const isCurrent = item => currentItem && currentItem.type === item.type && currentItem.id === item.id;

// "2 Oct 2026, 14:37" in local time, from PocketBase's UTC stamp.
function stamp(s, withTime = true){
  if(!s) return "";
  const d = new Date(s.replace(" ", "T"));
  if(isNaN(d)) return "";
  const day = d.getDate()+" "+MON[d.getMonth()].slice(0,3)+" "+d.getFullYear();
  return withTime ? day+", "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0") : day;
}

function openNotes(item){
  currentItem = item;
  const list = notesOf(item);
  currentNoteId = list.length ? list[0].id : null;
  renderNotes();
}

function renderNotes(){
  const item = currentItem;
  const list = notesOf(item);
  const canEdit = mayEdit();
  const kind = item.type;

  $("note-count").textContent = list.length || "";
  $("note-new").hidden = !canEdit;
  $("note-list").innerHTML = list.map(n=>`
    <button type="button" class="noteitem${n.id===currentNoteId?" on":""}" data-note="${n.id}"
      ${n.id===currentNoteId?'aria-current="true"':""}>
      <span class="nt">${esc(n.title || "Untitled note")}</span>
      <span class="nm">${esc(n.author_name || "Unknown author")}${n.created ? " &middot; "+esc(stamp(n.created, false)) : ""}</span>
    </button>`).join("");

  const note = list.find(n=>n.id===currentNoteId);
  $("note-edit").hidden = !note;
  $("note-empty").hidden = !!note;
  $("note-empty").textContent = canEdit
    ? "No notes for this "+kind+" yet. Add one with “+ New note”."
    : "No notes for this "+kind+".";
  if(!note) return;

  const title = $("note-title");
  title.value = note.title || "";
  title.readOnly = !canEdit;
  const input = $("note-input");
  input.innerHTML = sanitizeHtml(note.body || "");
  input.setAttribute("contenteditable", canEdit ? "true" : "false");
  input.classList.toggle("readonly", !canEdit);
  input.setAttribute("data-placeholder", canEdit ? "Write the note…" : "Empty note.");
  $("note-toolbar").hidden = !canEdit;
  $("note-delete").hidden = !canEdit;
  $("note-meta").textContent = "Created by "+(note.author_name || "unknown author")
    + (note.created ? " on "+stamp(note.created) : "")
    + (note.updated && stamp(note.updated) !== stamp(note.created) ? " · edited "+stamp(note.updated) : "");
  $("note-status").textContent = " ";   // non-breaking space: keeps the line's height
}

// Only the selected note's title in the list changes while typing - a full
// re-render would replace the field being typed into.
function refreshListTitle(note){
  const el = document.querySelector(`#note-list [data-note="${note.id}"] .nt`);
  if(el) el.textContent = note.title || "Untitled note";
}

async function newNote(){
  const item = currentItem;
  if(!item) return;
  const isCourse = item.type === "course";
  try{
    const rec = await pb.collection(isCourse ? "course_notes" : "session_notes")
      .create({ [isCourse ? "course" : "session"]: item.id, title: "Untitled note", body: "" });
    const store = storeFor(item);
    (store[item.id] ||= []).unshift(noteFrom(rec));
    if(!isCurrent(item)) return;
    currentNoteId = rec.id;
    renderNotes();
    $("note-title").focus();
    $("note-title").select();
  }catch(err){
    reportSaveError(err);
  }
}

// Saves one field of one note. `item` and `note` are captured when the edit
// happens, so a save that lands after switching notes still goes to the
// right record and doesn't touch the note now on show.
async function saveField(item, note, field, value){
  const statusEl = $("note-status");
  const shown = () => isCurrent(item) && currentNoteId === note.id;
  try{
    const rec = await pb.collection(item.type === "course" ? "course_notes" : "session_notes")
      .update(note.id, { [field]: value });
    note[field] = rec[field];
    note.updated = rec.updated;
    if(shown()) statusEl.textContent = "Saved";
  }catch(err){
    if(shown()) statusEl.textContent = "Could not save - check your connection.";
    reportSaveError(err);
  }
}

function editedNote(){
  return currentItem && notesOf(currentItem).find(n=>n.id===currentNoteId);
}

async function deleteNote(){
  const item = currentItem, note = editedNote();
  if(!note) return;
  if(!await ask("Delete the note “"+(note.title || "Untitled note")+"”? This can't be undone.",
                { ok: "Delete", danger: true })) return;
  try{
    await pb.collection(item.type === "course" ? "course_notes" : "session_notes").delete(note.id);
    const list = notesOf(item);
    const i = list.indexOf(note);
    if(i >= 0) list.splice(i, 1);
    if(!isCurrent(item)) return;
    currentNoteId = list.length ? list[Math.min(i, list.length-1)].id : null;
    renderNotes();
  }catch(err){
    reportSaveError(err);
  }
}

export default {
  init(){
    $("note-new").addEventListener("click", newNote);
    $("note-delete").addEventListener("click", deleteNote);
    $("note-list").addEventListener("click", e=>{
      const b = e.target.closest("[data-note]");
      if(!b) return;
      currentNoteId = b.dataset.note;
      renderNotes();
    });
    $("note-title").addEventListener("input", e=>{
      const item = currentItem, note = editedNote();
      if(!note) return;
      note.title = e.target.value;
      refreshListTitle(note);
      $("note-status").textContent = "Saving…";
      const value = e.target.value.trim() || "Untitled note";
      debounceSave("note:"+note.id+":title", ()=>saveField(item, note, "title", value));
    });
    $("note-input").addEventListener("input", e=>{
      const item = currentItem, note = editedNote();
      if(!note) return;
      $("note-status").textContent = "Saving…";
      const html = sanitizeHtml(e.target.innerHTML);
      note.body = html;
      debounceSave("note:"+note.id+":body", ()=>saveField(item, note, "body", html));
    });
    document.querySelectorAll("#note-toolbar [data-cmd]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const input = $("note-input");
        input.focus();
        document.execCommand(btn.dataset.cmd, false, null);
        input.dispatchEvent(new Event("input", { bubbles:true }));
      });
    });
    // Tabs: click, or arrow keys along the row (the usual tablist keys).
    const tabRow = document.querySelector("#backdrop .ftabs");
    tabRow.addEventListener("click", e=>{
      const t = e.target.closest(".ftab");
      if(t) selectTab(t.dataset.tab);
    });
    tabRow.addEventListener("keydown", e=>{
      const tabs = visibleTabs();
      const i = tabs.indexOf(document.activeElement);
      if(i < 0) return;
      const to = { ArrowRight: i+1, ArrowLeft: i-1, Home: 0, End: tabs.length-1 }[e.key];
      if(to === undefined) return;
      e.preventDefault();
      selectTab(tabs[(to + tabs.length) % tabs.length].dataset.tab, true);
    });
    // Close on the Close button or a click on the dimmed backdrop itself.
    $("backdrop").addEventListener("click", e=>{
      if(e.target.id==="sheet-close" || e.target.id==="backdrop") close();
    });
    // Not while an in-app dialog is up - its own Escape cancels that.
    document.addEventListener("keydown", e=>{
      if(e.key==="Escape" && !document.querySelector("#dialog.open")) close();
    });
  },
  reset(){ close(false, true); },
};
