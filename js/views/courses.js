/* Courses view (#pane-courses): groups -> courses -> sessions as a
   collapsible list, plus admin edit mode (inline fields, add/delete).
   Also owns the top bar's "Expand all" button. */
import { pb } from "../core/pb.js";
import {
  GROUPS, COURSES, G, ROOMS, DEPARTMENTS, PALETTE, GROUP_LIMIT, SESSION_TOTALS,
  reindexGroups, rebuildBookings, findCourse, courseText, sessionText, courseInPeriod,
} from "../core/data.js";
import { CHEV, esc, shortDate, toISO, debounceSave } from "../core/util.js";
import { ui, rerender, reportSaveError } from "../core/shell.js";
import { period, inPeriod, clampISO, outsideMessage } from "../core/period.js";
import { openSession, openCourse } from "./sheet.js";
import { ask, tell } from "../core/dialog.js";
import { lineUp } from "../core/rowdetails.js";
import { siteId, isAll, siteById, siteColour, siteTint } from "../core/site.js";

const ID = "pane-courses";
const $ = id => document.getElementById(id);

const openCourses = new Set();
const openGroups  = new Set();
let countText = "";   // shown in the top bar by the shell (count())


// The rest of the board (schedule grids, legend) reads the same data, so
// after a data change: rebuild the flattened bookings and redraw the others.
function dataChanged(){ rebuildBookings(); rerender(ID); }

/* ------------------------------ render ------------------------------- */
function render(){
  const q = ui.q, editing = ui.editing;
  const filtering = q.length > 0;
  let html = "", shownCourses = 0, shownSessions = 0;

  GROUPS.forEach(g=>{
    // Work out what survives the filter before drawing anything.
    const inGroup = [];
    COURSES.forEach((c,i)=>{
      // Only this financial year's courses (core/data.js courseInPeriod).
      if(c.group !== g.id || !courseInPeriod(c)) return;
      const cMatch = !filtering || courseText(c).includes(q);
      const sessions = c.sessions
        .map((s,si)=>({s,si}))
        .filter(x => !filtering || cMatch || sessionText(x.s).includes(q));
      if(!filtering || cMatch || sessions.length) inGroup.push({c,i,sessions});
    });
    if(!inGroup.length && !(editing && !filtering)) return;

    // Within a group, order by department (in DEPARTMENTS' own order, not
    // alphabetically), then by title as a tiebreak so same-department
    // courses don't jump around between renders. Departments not in the
    // list (data can always be edited directly in PocketBase) sort after
    // every known one rather than crashing or sorting first.
    const deptRank = d => { const i = DEPARTMENTS.indexOf(d); return i===-1 ? DEPARTMENTS.length : i; };
    inGroup.sort((a,b) => deptRank(a.c.department) - deptRank(b.c.department) || a.c.title.localeCompare(b.c.title));

    const sessionCount = inGroup.reduce((n,x)=>n+x.sessions.length,0);
    shownCourses += inGroup.length;
    shownSessions += sessionCount;
    const gOpen = filtering || openGroups.has(g.id);

    // Each group is a section: its header sits above a rounded card (.gcard)
    // holding the course/session rows. The header box is filled with the
    // group's light tint (css: .grouphead) - the Timetable uses the same
    // ink/tint pair for its blocks.
    // In "All" (core/site.js, the user's design 2026-10-07) a group wears
    // its SITE's colour, not its own, and carries the site's name.
    const st = isAll() ? siteById(g.site) : null;
    const ink = st ? siteColour(st) : g.ink, tint = st ? siteTint(st) : g.tint;
    const tag = st ? `<span class="sitetag" style="--site:${esc(ink)}">${esc(st.name)}</span>` : "";
    html += `<section class="gsec"><div class="grouphead" data-group="${g.id}" aria-expanded="${gOpen}"
      style="--gink:${ink};--gtint:${tint}">
      <div class="gname">${CHEV}${tag}${ editing
        ? `<input class="ed gtitle" value="${esc(g.name)}" data-gid="${g.id}" data-gfield="name">
           <select class="ed gcol" data-gid="${g.id}" data-gfield="colour">${
             PALETTE.map(p=>`<option value="${p.ink}"${p.ink===g.ink?" selected":""}>${p.name}</option>`).join("")}</select>`
        : esc(g.name) }
        <span class="gcount">${inGroup.length} courses, ${sessionCount} sessions</span>
      </div>
      ${ editing ? `<button class="delg ibtn danger" data-delgroup="${g.id}" title="Delete group">&times;</button>` : "" }
    </div>`;
    if(!gOpen){ html += `</section>`; return; }
    html += `<div class="gcard">`;

    inGroup.forEach(({c,sessions})=>{
      const cOpen = filtering || openCourses.has(c.id);
      // The row opens the course's pop-up; only the chevron button
      // expands/collapses its sessions.
      const exp = `<button type="button" class="exp" data-toggle="${c.id}" aria-expanded="${cOpen}"
            aria-label="${cOpen?"Hide":"Show"} sessions">${CHEV}</button>`;
      // View mode: the title, then its details - a count first, then what
      // was typed in (css: .lined/.rdata, js/core/rowdetails.js).
      if(!editing) html += `<div class="row item course lined" data-open-course="${c.id}" tabindex="0">
        <div class="name">${exp}<span class="ititle ctitle">${esc(c.title)}</span></div>
        <div class="rdata" data-kind="course">
          <span class="rd calc">${sessions.length} session${sessions.length===1?"":"s"}</span>
          <span class="rd">${c.department ? esc(c.department) : "&nbsp;"}</span>
          <span class="rd">${c.lead ? esc(c.lead) : "&nbsp;"}</span>
          <span class="rd">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "&nbsp;"}</span>
        </div>
      </div>`;
      else html += `<div class="row item course" data-open-course="${c.id}">
        <div class="name">${exp}${ editing
          ? `<input class="ed" value="${esc(c.title)}" data-uid="${c.id}" data-field="title">`
          : `<span class="ititle ctitle">${esc(c.title)}</span>` }</div>
        <div class="muted">${ editing
          ? `<select class="ed grp" data-uid="${c.id}" data-field="group">${
              GROUPS.map(x=>`<option value="${x.id}"${x.id===c.group?" selected":""}>${esc(x.name)}</option>`).join("")}</select>`
          : `<span class="tag">${sessions.length} session${sessions.length===1?"":"s"}</span>` }</div>
        <div class="muted">${ editing
          ? `<select class="ed" data-uid="${c.id}" data-field="department">${
              DEPARTMENTS.map(d=>`<option${d===c.department?" selected":""}>${esc(d)}</option>`).join("")}</select>`
          : c.department ? `<span class="tag">${esc(c.department)}</span>` : "" }</div>
        <div>${ editing
          ? `<input class="ed" value="${esc(c.lead)}" data-uid="${c.id}" data-field="lead">`
          : esc(c.lead) }</div>
        <div>${ editing
          ? `<input class="ed" value="${esc(c.email)}" data-uid="${c.id}" data-field="email">`
          : `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` }</div>
        <button class="del ibtn danger" data-del="${c.id}" title="Delete course">&times;</button>
      </div>`;

      // Nothing under it (and nothing to add, outside edit mode): no empty card.
      if(cOpen && (sessions.length || editing)){
        // The sessions sit on a white band inside the course card, in their
        // own bordered card (css: .subs/.subcard, shared in base.css).
        html += `<div class="subs"><div class="subcard">`;
        sessions.forEach(({s,si})=>{
          // Same grid shape as a course row, in both view and edit mode -
          // sessions read as the same kind of row as courses, just nested.
          html += editing
            ? `<div class="row sub session" data-open="${s.id}">
                <div class="name">
                  <input class="ed" value="${esc(s.title)}" data-uid="${c.id}" data-si="${si}" data-field="title">
                </div>
                <div class="muted">
                  <select class="ed" data-uid="${c.id}" data-si="${si}" data-field="room">${
                    ROOMS.map(r=>`<option${r===s.room?" selected":""}>${esc(r)}</option>`).join("")}</select>
                </div>
                <div class="muted tnum">
                  <input class="ed" type="date" value="${esc(s.date)}" min="${period.start}" max="${period.end}"
                    data-uid="${c.id}" data-si="${si}" data-field="date">
                </div>
                <div class="muted tnum">
                  <span class="pair">
                    <input class="ed" type="time" value="${esc(s.start)}" data-uid="${c.id}" data-si="${si}" data-field="start">
                    <input class="ed" type="time" value="${esc(s.end)}" data-uid="${c.id}" data-si="${si}" data-field="end">
                  </span>
                </div>
                <button class="del ibtn danger" data-del="${c.id}:${si}" title="Delete session">&times;</button>
              </div>`
            : `<div class="row sub session lined" data-open="${s.id}" tabindex="0">
                <div class="name"><span class="ititle">${esc(s.title)}</span></div>
                <div class="rdata" data-kind="session">
                  <span class="rd">${s.room ? esc(s.room) : "&nbsp;"}</span>
                  <span class="rd">${shortDate(s.date)}</span>
                  <span class="rd">${esc(s.start)}&ndash;${esc(s.end)}</span>
                </div>
              </div>`;
        });
        if(editing) html += `<div class="addrow addsub addsession" data-add-session="${c.id}">Add session</div>`;
        html += `</div></div>`;
      }
    });

    if(editing && !filtering)
      html += `<div class="addrow additem addcourse" data-add-course="${g.id}">Add course</div>`;
    html += `</div></section>`;
  });

  if(editing && !filtering)
    html += GROUPS.length < GROUP_LIMIT
      ? `<div class="addrow addgroup" data-add-group>Add group</div>`
      : `<div class="addrow addgroup off">Group limit reached, ${GROUP_LIMIT} maximum</div>`;

  $("rows").innerHTML = html || (filtering
    ? `<div class="empty">Nothing matches that filter. Try a course, room, lead or date.</div>`
    : `<div class="empty">No courses in ${esc(period.label)} yet.</div>`);
  countText = shownCourses+" courses, "+shownSessions+" sessions";
  lineUp($("rows"));
}

/* ------------------------------ editing ------------------------------ */
function applyEditLocal(el){
  const c = findCourse(el.dataset.uid);
  if(!c) return null;
  const f = el.dataset.field;
  if(el.dataset.si === undefined){ c[f] = el.value; return { collection:"courses", id:c.id, field:f, value:c[f] }; }
  const s = c.sessions[Number(el.dataset.si)];
  s[f] = el.value;
  return { collection:"sessions", id:s.id, field:f, value:s[f] };
}
function persist(edit){
  if(!edit) return;
  pb.collection(edit.collection).update(edit.id, { [edit.field]: edit.value }).catch(reportSaveError);
}

function applyGroupEditLocal(el){
  const g = G[el.dataset.gid];
  if(!g) return null;
  if(el.dataset.gfield === "name"){
    g.name = el.value;
    dataChanged();
    return { id:g.id, patch:{ name:g.name } };
  }
  const p = PALETTE.find(p=>p.ink === el.value);
  if(p){ g.ink = p.ink; g.tint = p.tint; }
  render(); dataChanged();
  return { id:g.id, patch:{ ink:g.ink, tint:g.tint } };
}
function persistGroup(edit){
  if(!edit) return;
  pb.collection("groups").update(edit.id, edit.patch).catch(reportSaveError);
}

function onInput(e){
  const el = e.target.closest("[data-field]");
  // A session's date must stay inside the financial year on show. The
  // picker can't go outside it (min/max); a typed date outside it isn't
  // saved, and is put back when the field is left (onFocusOut). Typing goes
  // through outside dates on the way (each digit of a year), so this can't
  // warn on every keystroke.
  if(el && el.type === "date"){
    const ok = inPeriod(el.value);
    el.classList.toggle("bad", !!el.value && !ok);
    if(!ok) return;
  }
  if(el && el.tagName === "INPUT"){
    const edit = applyEditLocal(el);
    dataChanged();   // not render(): that would replace the field being typed in
    if(edit) debounceSave(edit.collection+":"+edit.id+":"+edit.field, ()=>persist(edit));
    return;
  }
  const gel = e.target.closest("[data-gfield]");
  if(gel && gel.tagName === "INPUT"){
    const edit = applyGroupEditLocal(gel);
    if(edit) debounceSave("groups:"+edit.id+":name", ()=>persistGroup(edit));
  }
}

function onFocusOut(e){
  const el = e.target;
  if(!el.matches?.('input[type=date][data-field]') || !el.classList.contains("bad")) return;
  const c = findCourse(el.dataset.uid), s = c?.sessions[Number(el.dataset.si)];
  const typed = el.value;
  el.value = s ? s.date : "";
  el.classList.remove("bad");
  tell(outsideMessage(typed));
}

function onChange(e){
  const gel = e.target.closest("[data-gfield]");
  if(gel && gel.tagName === "SELECT"){ persistGroup(applyGroupEditLocal(gel)); return; }
  const el = e.target.closest("[data-field]");
  if(!el || el.tagName !== "SELECT") return;
  const edit = applyEditLocal(el);
  persist(edit);
  render();  // a group change moves the course to another section
  dataChanged();
}

/* Clicks inside the pane. Order matters where elements nest: delete/add
   buttons and a course's expand button ([data-toggle]) sit inside rows, so
   they're checked before the row's own [data-open]/[data-open-course]. */
async function onClick(e){
  if(e.target.closest("a,input,select")) return;

  const dg = e.target.closest("[data-delgroup]");
  if(dg){
    const id = dg.getAttribute("data-delgroup");
    if(GROUPS.length <= 1) return;   // one group has to remain
    const n = COURSES.filter(c=>c.group===id).length;
    if(n && !await ask("Delete this group and the "+n+" courses in it?", { ok: "Delete", danger: true })) return;
    try{
      await pb.collection("groups").delete(id);  // cascades to its courses and sessions
    }catch(err){ reportSaveError(err); return; }
    for(let i=COURSES.length-1;i>=0;i--) if(COURSES[i].group===id) COURSES.splice(i,1);
    GROUPS.splice(GROUPS.findIndex(g=>g.id===id),1);
    openGroups.delete(id);
    reindexGroups(); render(); dataChanged();
    return;
  }

  if(e.target.closest("[data-add-group]") && GROUPS.length < GROUP_LIMIT){
    const used = new Set(GROUPS.map(g=>g.ink));
    const p = PALETTE.find(p=>!used.has(p.ink)) || PALETTE[0];
    try{
      // Filed under the site on show; courses and sessions inside it take
      // its site on the server (pb_hooks/sites.pb.js).
      const rec = await pb.collection("groups").create({ site:siteId(), name:"New group", ink:p.ink, tint:p.tint, sort:GROUPS.length });
      const g = { id:rec.id, name:rec.name, ink:rec.ink, tint:rec.tint };
      GROUPS.push(g); openGroups.add(g.id);
      reindexGroups(); render(); dataChanged();
    }catch(err){ reportSaveError(err); }
    return;
  }

  const del = e.target.closest("[data-del]");
  if(del){
    const [uid,si] = del.getAttribute("data-del").split(":");
    const c = findCourse(uid);
    if(c){
      // Removing a course cascades to all its sessions (and notes), so say
      // how much is about to go.
      const n = c.sessions.length;
      const msg = si === undefined
        ? `Delete the course "${c.title}"`+(n ? ` and its ${n} session${n===1?"":"s"}?` : "?")
        : `Delete the session "${c.sessions[Number(si)].title}"?`;
      if(!await ask(msg, { ok: "Delete", danger: true })) return;
      try{
        if(si === undefined) await pb.collection("courses").delete(c.id);
        else await pb.collection("sessions").delete(c.sessions[Number(si)].id);
      }catch(err){ reportSaveError(err); return; }
      if(si === undefined){ COURSES.splice(COURSES.indexOf(c),1); delete SESSION_TOTALS[c.id]; }
      else { c.sessions.splice(Number(si),1); SESSION_TOTALS[c.id] = Math.max((SESSION_TOTALS[c.id] || 1) - 1, 0); }
      render(); dataChanged();
    }
    return;
  }

  const addS = e.target.closest("[data-add-session]");
  if(addS){
    const c = findCourse(addS.getAttribute("data-add-session"));
    if(!c) return;
    try{
      // Dated to the Monday of the week on show in the Timetable - or the
      // year's first day, when that week starts before the year does.
      const rec = await pb.collection("sessions").create({
        title:"New session", room:ROOMS[0], date:clampISO(toISO(ui.weekStart)), start:"09:00", end:"12:00",
        course:c.id, sort:c.sessions.length,
      });
      c.sessions.push({ id:rec.id, title:rec.title, room:rec.room, date:rec.date, start:rec.start, end:rec.end, staff:[] });
      SESSION_TOTALS[c.id] = (SESSION_TOTALS[c.id] || 0) + 1;
      render(); dataChanged();
    }catch(err){ reportSaveError(err); }
    return;
  }

  const addC = e.target.closest("[data-add-course]");
  if(addC){
    const groupId = addC.getAttribute("data-add-course");
    try{
      const rec = await pb.collection("courses").create({
        title:"New course", lead:"", email:"", department:DEPARTMENTS[0], group:groupId, sort:COURSES.length,
      });
      const c = { id:rec.id, group:rec.group, title:rec.title, lead:rec.lead, email:rec.email, department:rec.department, sessions:[] };
      COURSES.push(c); openCourses.add(c.id);
      render(); dataChanged();
    }catch(err){ reportSaveError(err); }
    return;
  }

  const t = e.target.closest("[data-toggle]");
  if(t){
    const id = t.getAttribute("data-toggle");
    openCourses.has(id) ? openCourses.delete(id) : openCourses.add(id);
    render();
    // Keep focus on the same expand button after the redraw.
    $("rows").querySelector(`[data-toggle="${id}"]`)?.focus({ preventScroll:true });
    return;
  }

  // In edit mode a click on a row is for editing it, not opening it.
  const o = e.target.closest("[data-open]");
  if(o && !ui.editing){ openSession(o.getAttribute("data-open")); return; }

  const oc = e.target.closest("[data-open-course]");
  if(oc && !ui.editing){ openCourse(oc.getAttribute("data-open-course")); return; }

  const g = e.target.closest("[data-group]");
  if(g){
    const id = g.getAttribute("data-group");
    openGroups.has(id) ? openGroups.delete(id) : openGroups.add(id);
    render(); return;
  }
}

// The top bar's Expand all / Collapse all button (shared by views that ask
// for it in their toolbar), labelled for this view's own state.
const syncToggleLabel = () => {
  $("collapse-all").textContent = (openGroups.size || openCourses.size) ? "Collapse all" : "Expand all";
};
function toggleAll(){
  if(openGroups.size || openCourses.size){
    openGroups.clear(); openCourses.clear();
  } else {
    GROUPS.forEach(g=>openGroups.add(g.id));
    COURSES.forEach(c=>openCourses.add(c.id));
  }
  syncToggleLabel();
  render();
}

export default {
  id: ID,
  label: "Courses",
  toolbar: { filter: "Filter courses, rooms, leads", expandAll: true },
  init(){
    const pane = $(ID);
    pane.addEventListener("click", onClick);
    // Enter/Space on a focused row opens it, as a click would.
    pane.addEventListener("keydown", e=>{
      if((e.key==="Enter" || e.key===" ") && e.target.matches(".row[tabindex]")){
        e.preventDefault();
        e.target.click();
      }
    });
    pane.addEventListener("input", onInput);
    pane.addEventListener("change", onChange);
    pane.addEventListener("focusout", onFocusOut);
  },
  render,
  show: syncToggleLabel,
  count: () => countText,
  toggleAll,
  status(kind, message){
    $("rows").innerHTML = kind === "loading"
      ? `<div class="empty">Loading&hellip;</div>`
      : `<div class="empty">${esc(message)}</div>`;
  },
  // A new site (or All, which shows the same records) starts collapsed.
  siteChanged(){ openGroups.clear(); openCourses.clear(); syncToggleLabel(); },
  reset(){
    openGroups.clear(); openCourses.clear();
    countText = "";
    syncToggleLabel();
    $("rows").innerHTML = "";
  },
};
