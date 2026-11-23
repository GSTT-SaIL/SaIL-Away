/* The booking data every view reads: groups, courses (with their sessions),
   notes, and the reference lists. These are the in-memory copy the UI
   renders from; loadAll() fills them after sign-in, and edits write through
   to PocketBase then update the copy in place.

   Everything is exported as a constant array/object that is mutated in
   place (never reassigned), so every importer always sees current data. */
import { pb } from "./pb.js";
import { shortDate } from "./util.js";
import { period } from "./period.js";
import { siteFilter, andSite, isAll, siteOrder } from "./site.js";

export const GROUPS = [];
export const COURSES = [];
// One flattened entry per session, carrying its course's details - what the
// schedule grids and the detail sheet read.
export const BOOKINGS = [];
// Groups by id.
export const G = {};
// Notes, keyed by session/course id: a list of notes (noteFrom() below),
// newest first. Several per item, each with a title and its author
// (pocketbase/pb_migrations/1735000015_multi_notes.js); separate
// collections from "sessions"/"courses" (1735000004 / 1735000005).
export const NOTES = {};
export const COURSE_NOTES = {};
// Sessions per course across ALL years (only the financial year on show is
// loaded into COURSES[].sessions). A course with none at all shows in every
// year, so a new one is always reachable to add sessions to.
export const SESSION_TOTALS = {};

export const GROUP_LIMIT = 8;
export const PALETTE = [
  { name:"Blue",     ink:"#0060c0", tint:"#e8f1fd" },
  { name:"Green",    ink:"#1c7a3e", tint:"#e6f5eb" },
  { name:"Purple",   ink:"#8944c8", tint:"#f3ecfc" },
  { name:"Orange",   ink:"#a35700", tint:"#fdefe1" },
  { name:"Pink",     ink:"#c02a5c", tint:"#fdeaf0" },
  { name:"Teal",     ink:"#00798a", tint:"#e2f4f7" },
  { name:"Indigo",   ink:"#4a4ac4", tint:"#ebebfb" },
  { name:"Graphite", ink:"#4c5560", tint:"#eef0f2" }
];

// Reference lists, names only, in display order - from the "rooms" and
// "departments" collections (edited by a superuser in the PocketBase
// dashboard; see pb_migrations/1735000007_add_rooms_departments.js).
// Department = which hospital department runs/owns a course. Deliberately
// not called "group": that word already means the coloured sections
// (GROUPS above) - a different, unrelated concept.
export const ROOMS = [];
export const DEPARTMENTS = [];
// The rooms with their site - in "All" (core/site.js) several sites' rooms
// show together, and two sites can have a room of the same name.
export const ROOM_LIST = [];

const clearObject = o => { for(const k of Object.keys(o)) delete o[k]; };

export function reindexGroups(){
  clearObject(G);
  GROUPS.forEach(g=>{ G[g.id] = g; });
}

export const findCourse = id => COURSES.find(c=>c.id===id);
// Does this course belong to the financial year on show? (core/period.js)
export const courseInPeriod = c => c.sessions.length > 0 || !SESSION_TOTALS[c.id];
export const courseText = c => [c.title,c.lead,c.email,c.department,(G[c.group]||{}).name||""].join(" ").toLowerCase();
export const sessionText = s => [s.title,s.room,shortDate(s.date),s.start,s.end].join(" ").toLowerCase();

export function rebuildBookings(){
  BOOKINGS.length = 0;
  COURSES.forEach(c=>c.sessions.forEach(s=>BOOKINGS.push({
    ...s, site:c.site, group:c.group, courseTitle:c.title,
    lead:c.lead, email:c.email, text: courseText(c)+" "+sessionText(s)
  })));
}

// One note, as the sheet uses it. created/updated are PocketBase's UTC
// stamps ("" on notes from before 1735000015).
export const noteFrom = r => ({ id:r.id, title:r.title, body:r.body, author_name:r.author_name,
                                created:r.created, updated:r.updated });
// Newest first; notes with no date (the oldest) last.
export const sortNotes = list => list.sort((a,b)=>(b.created||"").localeCompare(a.created||""));

// Loads the site and financial year on show (core/site.js, core/period.js):
// the site's records only, and of those, the year's sessions and their
// notes. Courses, groups, course notes and the reference lists aren't dated,
// so they always load; which courses show is courseInPeriod(). Switching
// site or year calls this again.
export async function loadAll(){
  const inYear = andSite(pb.filter("date >= {:s} && date <= {:e}", { s: period.start, e: period.end }));
  const notesInYear = andSite(pb.filter("session.date >= {:s} && session.date <= {:e}", { s: period.start, e: period.end }));
  const onSite = siteFilter();
  const [groupRecords, courseRecords, sessionRecords, noteRecords, courseNoteRecords,
         roomRecords, departmentRecords, allSessionCourses] = await Promise.all([
    pb.collection("groups").getFullList({ sort:"sort", filter: onSite }),
    pb.collection("courses").getFullList({ sort:"sort", filter: onSite }),
    // requestKey:null on both sessions calls: the SDK otherwise cancels the
    // first of two requests to the same collection made at once.
    pb.collection("sessions").getFullList({ sort:"sort", filter: inYear, requestKey: null }),
    pb.collection("session_notes").getFullList({ filter: notesInYear }),
    pb.collection("course_notes").getFullList({ filter: onSite }),
    pb.collection("rooms").getFullList({ sort:"sort", filter: onSite }),
    pb.collection("departments").getFullList({ sort:"sort", filter: onSite }),
    pb.collection("sessions").getFullList({ fields:"course", filter: onSite, requestKey: null }),
  ]);

  clearObject(SESSION_TOTALS);
  allSessionCourses.forEach(r=>{ SESSION_TOTALS[r.course] = (SESSION_TOTALS[r.course] || 0) + 1; });

  // In "All", everything is ordered by site first (the Site dropdown's order).
  const bySite = (a, b) => siteOrder(a.site) - siteOrder(b.site);
  if(isAll()) [roomRecords, groupRecords].forEach(list => list.sort(bySite));   // stable: keeps each site's own order

  ROOMS.length = 0;
  roomRecords.forEach(r=>ROOMS.push(r.name));
  ROOM_LIST.length = 0;
  roomRecords.forEach(r=>ROOM_LIST.push({ name:r.name, site:r.site }));
  DEPARTMENTS.length = 0;
  departmentRecords.forEach(r=>DEPARTMENTS.push(r.name));

  clearObject(NOTES);
  noteRecords.forEach(r=>{ (NOTES[r.session] ||= []).push(noteFrom(r)); });
  clearObject(COURSE_NOTES);
  courseNoteRecords.forEach(r=>{ (COURSE_NOTES[r.course] ||= []).push(noteFrom(r)); });
  [NOTES, COURSE_NOTES].forEach(store=>Object.values(store).forEach(sortNotes));

  GROUPS.length = 0;
  groupRecords.forEach(r=>GROUPS.push({ id:r.id, site:r.site, name:r.name, ink:r.ink, tint:r.tint }));
  reindexGroups();

  COURSES.length = 0;
  courseRecords.forEach(r=>COURSES.push({
    id:r.id, site:r.site, group:r.group, title:r.title, lead:r.lead, email:r.email, department:r.department, sessions:[]
  }));
  const byCourse = Object.fromEntries(COURSES.map(c=>[c.id,c]));
  sessionRecords.forEach(r=>{
    const c = byCourse[r.course];
    // staff: allocated people's account ids (the Allocate tab, the Rota).
    if(c) c.sessions.push({ id:r.id, title:r.title, room:r.room, date:r.date, start:r.start, end:r.end, staff:r.staff || [] });
  });

  rebuildBookings();
}

// Sign-out: drop everything user-specific from memory.
export function clearData(){
  GROUPS.length = 0; COURSES.length = 0; BOOKINGS.length = 0;
  ROOMS.length = 0; DEPARTMENTS.length = 0; ROOM_LIST.length = 0;
  clearObject(G); clearObject(NOTES); clearObject(COURSE_NOTES); clearObject(SESSION_TOTALS);
}
