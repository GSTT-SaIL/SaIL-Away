// Fills an empty SaIL-Away database with sample data and the test accounts
// (the old PB_DEV_SEED migrations, in one place). Run by tools/run.sh:
//
//   tools/run.sh seed
//
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and the TEST_*_PASSWORD values in
// the environment. Only seeds a database with no sites; it never touches one
// that has data. Accounts that already exist are left as they are.

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL = process.env.SITE_URL || "https://gstt-sail.github.io/SaIL-Away";
if (!URL_ || !KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are needed");

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function call(method, path, body, extra = {}) {
  const res = await fetch(URL_ + path, { method, headers: { ...H, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const insert = async (table, rows) => call("POST", `/rest/v1/${table}`, rows, { Prefer: "return=representation" });
const one = async (table, row) => (await insert(table, [row]))[0];
const select = async (table, query) => call("GET", `/rest/v1/${table}?${query}`);
const patch = async (table, query, row) => call("PATCH", `/rest/v1/${table}?${query}`, row, { Prefer: "return=minimal" });

// ------------------------------------------------------------ accounts

const ACCOUNTS = [
  // "editor@" is an admin - the old dev seed's name, kept so the tests match.
  { email: "editor@example.com", pw: "TEST_ADMIN_PASSWORD", name: "Alex Morgan", role: "admin", sites: ["sail"], home: "sail" },
  { email: "viewer@example.com", pw: "TEST_VIEWER_PASSWORD", name: "Sam Taylor", role: "viewer", sites: ["sail"], home: "sail" },
  { email: "cssc-editor@example.com", pw: "TEST_CSSC_EDITOR_PASSWORD", name: "Casey Lane", role: "editor", sites: ["cssc"], home: "cssc" },
  { email: "cssc-viewer@example.com", pw: "TEST_CSSC_VIEWER_PASSWORD", name: "Robin Hart", role: "viewer", sites: ["cssc"], home: "cssc" },
  { email: "both-editor@example.com", pw: "TEST_BOTH_EDITOR_PASSWORD", name: "Jordan Bell", role: "editor", sites: ["sail", "cssc"], home: "sail" },
];

async function accounts(siteId) {
  const existing = (await call("GET", "/auth/v1/admin/users?per_page=1000")).users || [];
  const people = {};
  for (const a of ACCOUNTS) {
    const password = process.env[a.pw];
    if (!password) throw new Error(`${a.pw} is not set`);
    let u = existing.find((x) => x.email === a.email);
    if (!u) {
      u = await call("POST", "/auth/v1/admin/users",
        { email: a.email, password, email_confirm: true, user_metadata: { name: a.name } });
      console.log("account", a.email, "created");
    } else {
      console.log("account", a.email, "already exists");
    }
    await patch("profiles", `id=eq.${u.id}`,
      { name: a.name, role: a.role, sites: a.sites.map((s) => siteId[s]), home_site: siteId[a.home] });
    people[a.email] = { id: u.id, site: siteId[a.home] };
  }
  return people;
}

// ------------------------------------------------------------ helpers

let seed = 20260907;
const rand = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return ymd(new Date(y, m - 1, d + n)); };
const fromToday = (n) => addDays(ymd(new Date()), n);

// ------------------------------------------------------------ main

async function main() {
  if ((await select("sites", "select=id&limit=1")).length) {
    console.log("The database already has sites - nothing seeded.");
    return;
  }

  const VIEWS = ["courses", "timetable", "tickets", "invoices", "forms", "staff", "rota", "apps"];
  const sail = await one("sites", {
    name: "SaIL", code: "sail", ref_prefix: "", views: VIEWS, logo: true, colour: "#a81765",
    full_name: "Simulation & Interactive Learning", sort: 0, eventbrite_organizer: "12243186560",
    eventbrite_venues: [
      { id: "33722319", name: "SaIL Centre, St Thomas' House" },
      { id: "33668478", name: "Sherman Education Centre, Guy's" },
    ],
  });
  const cssc = await one("sites", {
    name: "CSSC", code: "cssc", ref_prefix: "CSSC-", views: VIEWS.filter((v) => v !== "tickets"),
    colour: "#0e7c86", sort: 1,
  });
  const siteId = { sail: sail.id, cssc: cssc.id };
  console.log("sites: SaIL, CSSC");

  // Reference lists.
  const SAIL_ROOMS = ["Sim Suite 1", "Sim Suite 2", "Ward Simulation Room", "Skills Lab", "Debrief Room A", "Seminar Room 3"];
  const DEPARTMENTS = ["Emergency Medicine", "Paediatrics", "Intensive Care", "Surgery", "Cardiology", "Maternity",
                       "Infection Control", "Estates & Facilities", "Education & Training", "Patient Safety"];
  await insert("rooms", SAIL_ROOMS.map((name, sort) => ({ site: sail.id, name, sort })));
  await insert("departments", DEPARTMENTS.map((name, sort) => ({ site: sail.id, name, sort })));
  await insert("rooms", ["CSSC Skills Room", "CSSC Sim Lab"].map((name, sort) => ({ site: cssc.id, name, sort })));
  await insert("departments", ["Emergency Medicine", "Critical Care"].map((name, sort) => ({ site: cssc.id, name, sort })));

  const people = await accounts(siteId);

  // ---------------------------------------------------------- courses
  const DEPT_BY_TITLE = {
    "Advanced Life Support": "Emergency Medicine", "In Situ Ward Simulation": "Intensive Care",
    "Neonatal Resuscitation": "Maternity", "Acute Illness Management": "Intensive Care",
    "Postgraduate Teaching Programme": "Education & Training", "Human Factors in Theatres": "Surgery",
    "Debriefing Skills Foundation": "Education & Training", "Paediatric Early Warning Training": "Paediatrics",
    "Trauma Team Simulation": "Emergency Medicine", "Airway Management Refresher": "Intensive Care",
    "Sepsis Recognition Workshop": "Patient Safety", "Rapid Response Team Drill": "Intensive Care",
    "Critical Care Transfer Training": "Intensive Care", "Fire Safety and Evacuation Drill": "Estates & Facilities",
    "Manual Handling Refresher": "Estates & Facilities", "Infection Control Update": "Infection Control",
    "Medical Devices Training": "Estates & Facilities", "Basic Life Support Renewal": "Emergency Medicine",
    "Safeguarding Level 3": "Patient Safety", "Simulation Facilitator Training": "Education & Training",
    "Communication Skills Workshop": "Patient Safety", "Crew Resource Management": "Patient Safety",
    "Difficult Conversations Training": "Education & Training", "New Starter Induction": "Education & Training",
    "Train the Trainer Programme": "Education & Training",
  };
  const groups = {};
  for (const [i, g] of [
    { key: "internal-support", name: "Internal Support", ink: "#0060c0", tint: "#e8f1fd" },
    { key: "facility-only", name: "Facility Only", ink: "#1c7a3e", tint: "#e6f5eb" },
    { key: "internal", name: "Internal", ink: "#8944c8", tint: "#f3ecfc" },
  ].entries()) {
    groups[g.key] = await one("groups", { site: sail.id, name: g.name, ink: g.ink, tint: g.tint, sort: i });
  }
  const FIXED = [
    ["internal-support", "Advanced Life Support", "Priya Raman", [
      ["Day 1: rhythms and airway", "Sim Suite 1", "2026-09-07", "09:00", "17:00"],
      ["Day 2: team scenarios", "Sim Suite 1", "2026-09-08", "09:00", "17:00"],
      ["Assessment day", "Sim Suite 1", "2026-09-14", "09:00", "13:00"]]],
    ["internal-support", "In Situ Ward Simulation", "Amina Hassan", [
      ["Ward round scenario", "Ward Simulation Room", "2026-09-02", "14:00", "16:00"],
      ["Ward round scenario", "Ward Simulation Room", "2026-09-07", "14:00", "16:00"],
      ["Night shift scenario", "Sim Suite 2", "2026-09-10", "16:30", "19:30"]]],
    ["internal-support", "Neonatal Resuscitation", "Claire Whitfield", [
      ["Cohort 1: skills stations", "Skills Lab", "2026-09-01", "09:00", "12:00"],
      ["Cohort 2: skills stations", "Skills Lab", "2026-09-08", "09:00", "12:00"],
      ["Cohort 2: scenarios", "Sim Suite 2", "2026-09-08", "13:00", "16:00"]]],
    ["facility-only", "Acute Illness Management", "Tomasz Nowak", [
      ["Day 1: recognition", "Ward Simulation Room", "2026-09-10", "08:30", "16:30"],
      ["Day 2: escalation", "Ward Simulation Room", "2026-09-11", "08:30", "16:30"]]],
    ["facility-only", "Postgraduate Teaching Programme", "Helen Marsh", [
      ["Weekly seminar", "Seminar Room 3", "2026-09-08", "12:30", "14:00"],
      ["Weekly seminar", "Seminar Room 3", "2026-09-15", "12:30", "14:00"]]],
    ["internal", "Human Factors in Theatres", "Daniel Okonkwo", [
      ["Workshop: speaking up", "Seminar Room 3", "2026-09-09", "09:30", "12:30"],
      ["Theatre scenario block", "Sim Suite 2", "2026-09-09", "13:30", "16:30"],
      ["Repeat cohort", "Seminar Room 3", "2026-09-17", "09:30", "12:30"]]],
    ["internal", "Debriefing Skills Foundation", "Rachel Lindo", [
      ["Morning cohort", "Debrief Room A", "2026-09-11", "09:30", "13:00"],
      ["Afternoon cohort", "Debrief Room A", "2026-09-11", "14:00", "17:00"],
      ["Faculty refresher", "Debrief Room A", "2026-09-15", "09:30", "13:00"]]],
  ];
  const emailFor = (name) => name.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, ".") + "@example.nhs.uk";
  let deptFallback = 0;
  const deptFor = (title) => DEPT_BY_TITLE[title] || DEPARTMENTS[deptFallback++ % DEPARTMENTS.length];
  let nCourses = 0, nSessions = 0;
  for (const [ci, [g, title, lead, sessions]] of FIXED.entries()) {
    const c = await one("courses", { group: groups[g].id, title, lead, email: emailFor(lead), department: deptFor(title), sort: ci });
    await insert("sessions", sessions.map(([t, room, date, start, end], si) => ({ course: c.id, title: t, room, date, start, end, sort: si })));
    nCourses++; nSessions += sessions.length;
  }
  const SLOTS = [["09:00", "12:00"], ["13:00", "16:00"], ["09:00", "17:00"], ["14:00", "16:00"], ["08:30", "16:30"], ["09:30", "13:00"]];
  const LEADS = ["Fatima Al-Sayed", "Owen Brennan", "Grace Kowalski", "Marcus Delaney", "Nadia Petrova",
    "Liam O'Sullivan", "Sofia Marchetti", "Ewan Fraser", "Aisha Bello", "Connor Whyte", "Ingrid Haugen",
    "Diego Ferreira", "Yuki Tanaka", "Rosa Alonso", "Callum Reid", "Meera Chandran", "Bartosz Nowak",
    "Freya Lindqvist", "Kwame Asante", "Isla Grant"];
  const BULK = {
    "internal-support": ["Paediatric Early Warning Training", "Trauma Team Simulation", "Airway Management Refresher",
      "Sepsis Recognition Workshop", "Rapid Response Team Drill", "Critical Care Transfer Training"],
    "facility-only": ["Fire Safety and Evacuation Drill", "Manual Handling Refresher", "Infection Control Update",
      "Medical Devices Training", "Basic Life Support Renewal", "Safeguarding Level 3"],
    "internal": ["Simulation Facilitator Training", "Communication Skills Workshop", "Crew Resource Management",
      "Difficult Conversations Training", "New Starter Induction", "Train the Trainer Programme"],
  };
  let nextSort = 100;
  const usedLeads = new Set();
  for (const key of Object.keys(BULK)) {
    for (const title of BULK[key]) {
      let lead = pick(LEADS);
      while (usedLeads.has(lead) && usedLeads.size < LEADS.length) lead = pick(LEADS);
      usedLeads.add(lead);
      const c = await one("courses", { group: groups[key].id, title, lead, email: emailFor(lead), department: deptFor(title), sort: nextSort++ });
      const count = 1 + Math.floor(rand() * 3);
      let date = addDays("2026-09-14", Math.floor(rand() * 60));
      const rows = [];
      for (let i = 0; i < count; i++) {
        const slot = pick(SLOTS);
        rows.push({ course: c.id, title: count === 1 ? "Session" : "Day " + (i + 1), room: pick(SAIL_ROOMS),
                    date, start: slot[0], end: slot[1], sort: i });
        date = addDays(date, 1 + Math.floor(rand() * 12));
      }
      await insert("sessions", rows);
      nCourses++; nSessions += rows.length;
    }
  }
  // CSSC: one group, one course, a session in two days.
  const cg = await one("groups", { site: cssc.id, name: "CSSC Courses", ink: "#1d7a3a", tint: "#e7f5ec", sort: 0 });
  const cc = await one("courses", { group: cg.id, title: "CSSC Induction", lead: "Casey Lane",
                                    email: "casey.lane@example.nhs.uk", department: "Critical Care", sort: 0 });
  await one("sessions", { course: cc.id, title: "Day 1", room: "CSSC Sim Lab", date: fromToday(2), start: "09:00", end: "12:00", sort: 0 });
  console.log(`courses: ${nCourses + 1}, sessions: ${nSessions + 1}`);

  // ---------------------------------------------------------- invoices
  const attendee = [
    { key: "hf", name: "High-fidelity room", sub: "With seminar room", full: 30, half: 18, space: true },
    { key: "ward", name: "The Ward", sub: "Simulated ward environment", full: 30, half: 18, space: true },
    { key: "tech", name: "Simulation technician", sub: "Set-up, running and pack-down", full: 20, half: 12, space: false },
    { key: "cons", name: "Generic consumables", sub: "Gloves, cannulas, dressings, moulage", full: 10, half: 6, space: false },
    { key: "rec", name: "Reception", sub: "Sign-in desk, visitor passes, wayfinding", full: 8, half: 5, space: false },
    { key: "tea", name: "Tea and coffee", sub: "Breaks for attendees", full: 4, half: 2, space: false },
  ];
  const items = [
    { key: "senior", name: "Senior educator", unit: "day", price: 650 },
    { key: "faculty", name: "Simulation faculty", unit: "day", price: 480 },
    { key: "techhr", name: "Simulation technician", unit: "hour", price: 45 },
    { key: "report", name: "Report writing", unit: "hour", price: 75 },
    { key: "simman", name: "SimMan 3G manikin", unit: "day", price: 250 },
    { key: "simbaby", name: "SimBaby manikin", unit: "day", price: 180 },
    { key: "ivarm", name: "IV arm task trainer", unit: "day", price: 25 },
    { key: "av", name: "Portable AV debrief kit", unit: "day", price: 90 },
    { key: "delivery", name: "Delivery and collection", unit: "each", price: 120 },
  ];
  await patch("price_list", `site=eq.${sail.id}`, { attendee, items, vat: 20, valid_days: 30 });
  const types = {};
  for (const [i, t] of [["Events", "#0060c0", "#e8f1fd"], ["Consultancy", "#1c7a3e", "#e6f5eb"],
                        ["Equipment hire", "#8944c8", "#f3ecfc"], ["Other", "#4c5560", "#eef0f2"]].entries()) {
    types[t[0]] = await one("invoice_types", { site: sail.id, name: t[0], ink: t[1], tint: t[2], sort: i });
  }
  const snapshot = { attendee, items, vat: 20, valid: 30 };
  const year = 2026;
  const now = new Date();
  const shift = (date, days) => { const t = new Date(new Date(date).getTime() + days * 86400000); return (t > now ? now : t).toISOString(); };
  const A = (o) => ({ model: "attendee", length: "full", days: "1", custom: [], actual: "", ...o });
  const I = (o) => ({ model: "item", extras: [], ...o });
  const L = (item, qty, actual = "") => ({ item, desc: "", qty: String(qty), price: "", actual: String(actual) });
  const C = (desc, qty, price) => ({ item: "", desc, qty: String(qty), price: String(price), actual: "" });
  const EXAMPLES = [
    ["Events", "paid", 54, "£54.00 pp", 1425.6, A({ title: "Paediatric emergencies course", client: "Evelina Education Ltd", date: "10-21",
      paying: "24", items: { hf: true, tech: true, tea: true }, actual: "22" })],
    ["Events", "paid", 64, "£64.00 pp", 1536, A({ title: "Human factors study day", client: "King's College Hospital", date: "09-12",
      paying: "18", items: { ward: true, tech: true, cons: true, tea: true }, actual: "20" })],
    ["Events", "invoiced", 144, "£144.00 pp", 2592, A({ title: "Obstetric emergencies (PROMPT)", client: "Lewisham and Greenwich NHS Trust",
      date: "09-26", paying: "16", days: "2", items: { hf: true, tech: true, cons: true, rec: true, tea: true }, actual: "15" })],
    ["Events", "quoted", 38, "£38.00 pp", 0, A({ title: "Foundation doctors sim day", client: "Health Education England", date: "11-18",
      paying: "30", length: "half", items: { ward: true, tech: true, tea: true }, custom: [{ desc: "External speaker", price: "6" }] })],
    ["Events", "quoted", 34, "£34.00 pp", 0, A({ title: "Nursing preceptorship workshop", client: "Guy's and St Thomas' Charity", date: "12-09",
      paying: "", items: { ward: true, tea: true } })],
    ["Consultancy", "invoiced", 4020, "£4,020.00", 5054.88, I({ title: "In-situ sim programme design", client: "Croydon Health Services",
      date: "09-30", lines: [L("senior", 4, 5), L("report", 10, 12)], extras: [{ desc: "Travel", amount: "62.40" }] })],
    ["Consultancy", "quoted", 1692, "£1,692.00", 1692, I({ title: "Faculty development review", client: "Royal Brompton Hospital",
      date: "12-02", lines: [L("faculty", 2), L("report", 6)] })],
    ["Equipment hire", "paid", 480, "£480.00", 480, I({ title: "Manikin loan for open day", client: "St George's University",
      date: "08-21", lines: [L("simbaby", 1), L("ivarm", 4), L("delivery", 1)] })],
    ["Equipment hire", "quoted", 1368, "£1,368.00", 1368, I({ title: "AV kit and manikins, 3 days", client: "Oxleas NHS Foundation Trust",
      date: "11-24", lines: [L("simman", 3), L("av", 3), L("delivery", 1)] })],
    ["Equipment hire", "invoiced", 324, "£324.00", 324, I({ title: "Task trainer hire", client: "Kingston Hospital",
      date: "10-14", lines: [L("ivarm", 6), L("delivery", 1)] })],
    ["Other", "quoted", 696, "£696.00", 696, I({ title: "Photography for prospectus", client: "King's Health Partners",
      date: "11-06", lines: [C("Half-day room hire", 1, 400), L("techhr", 4)] })],
  ];
  // One at a time, oldest first, so the numbers run in date order.
  EXAMPLES.sort((a, b) => a[5].date.localeCompare(b[5].date));
  for (const [type, status, amount, label, total, d] of EXAMPLES) {
    const date = `${year}-${d.date}`;
    const invoiced = status !== "quoted";
    await one("invoices", {
      type: types[type].id, status, title: d.title, client: d.client, date, details: { ...d, date }, rates: snapshot,
      quote_amount: amount, quote_label: label, invoice_total: total,
      quoted_at: shift(date, -30), invoiced_at: invoiced ? shift(date, 3) : "",
    });
  }
  console.log(`invoices: ${EXAMPLES.length}`);

  // ---------------------------------------------------------- forms
  const agree = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
  const tenScale = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const roles = ["Doctor", "Nurse", "Physician associate", "AHP", "Other"];
  const matching = { id: "qcode", type: "text", label: "Anonymous matching code", required: true,
    help: "Your birth month as two digits, then the last 3 characters of your home postcode - e.g. 034NB. Use the same code before and after the course." };
  const evalGroup = await one("form_groups", { site: sail.id, name: "Course evaluation", ink: "#0060c0", tint: "#e8f1fd", sort: 0 });
  const foundation = await one("form_sets", { group: evalGroup.id, title: "Foundation", sort: 0 });
  await one("forms", { set: foundation.id, title: "Foundation Pre", sort: 0, open: true,
    settings: { intro: "Before the course: your experience and confidence now.\nYour answers are anonymous and used only to evaluate the course.", submitLabel: "", thanks: "Thank you - see you on the course.", anonymous: true },
    questions: [matching,
      { id: "qrole", type: "choice", label: "What is your current NHS role?", required: true, options: roles, display: "dropdown" },
      { id: "qother", type: "text", label: "Please specify your role", required: true, showIf: { q: "qrole", value: "Other" } },
      { id: "qinfo", type: "info", label: "How confident are you?", help: "1 - Definitely cannot do, 5 - Moderately can do, 10 - Definitely can do" },
      { id: "qprio", type: "choice", label: "Prioritising when many things are happening at once", required: true, options: tenScale, display: "scale" },
      { id: "qhelp", type: "choice", label: "Requesting help from colleagues in other professions", required: true, options: tenScale, display: "scale" },
      { id: "qhope", type: "long", label: "What do you hope to achieve on this course?", required: true }] });
  await one("forms", { set: foundation.id, title: "Foundation Post", sort: 1, open: true,
    settings: { intro: "After the course. Use the same matching code as before.", submitLabel: "", thanks: "Thank you for your feedback.", anonymous: true },
    questions: [matching,
      { id: "qmet", type: "choice", label: "The course met my expectations", required: true, options: agree, display: "list" },
      { id: "qprio", type: "choice", label: "Prioritising when many things are happening at once", required: true, options: tenScale, display: "scale" },
      { id: "qgood", type: "long", label: "What was good about today's course?", required: true },
      { id: "qchange", type: "long", label: "What would you change, if anything?", required: false }] });
  const regGroup = await one("form_groups", { site: sail.id, name: "Registration", ink: "#1c7a3e", tint: "#e6f5eb", sort: 1 });
  const knots = await one("form_sets", { group: regGroup.id, title: "Basic Knot Tying", sort: 0 });
  await one("forms", { set: knots.id, title: "Registration - 10 September", sort: 0, open: false,
    settings: { intro: "Level 1 - Basic Knot Tying, Thursday 13:30-14:30.", submitLabel: "Register", thanks: "You're registered - we'll email you before the session.", anonymous: false },
    questions: [
      { id: "qname", type: "text", label: "Full name", required: true },
      { id: "qjob", type: "text", label: "Current role", required: true },
      { id: "qemail", type: "email", label: "Email address", help: "We'll use this to confirm your place.", required: true },
      { id: "qconsent", type: "yesno", label: "I agree to my details being kept for this session's registration.", required: true }] });
  console.log("forms: 3");

  // ---------------------------------------------------------- leave
  const LEAVE = [
    ["editor@example.com", "annual", 7, 11], ["editor@example.com", "wfh", 2, 2],
    ["editor@example.com", "annual", 0, 0, "13:00", "17:00"], ["viewer@example.com", "sick", -3, -2],
    ["viewer@example.com", "wfh", 4, 4], ["cssc-editor@example.com", "annual", 14, 18],
    ["cssc-viewer@example.com", "wfh", 1, 1, "09:00", "12:30"],
  ];
  await insert("leave", LEAVE.map(([email, kind, a, b, from = "", to = ""]) =>
    ({ person: people[email].id, site: people[email].site, kind, start: fromToday(a), end: fromToday(b), from, to })));
  console.log(`leave: ${LEAVE.length}`);

  // ---------------------------------------------------------- apps, public course list
  const link = await one("pub_courses_links", { label: "Tests" });
  await insert("apps", [
    { title: "Upcoming courses", description: "SaIL's upcoming courses on Eventbrite, for staff to book.",
      url: `${SITE_URL}/public/courses/#${link.token}`, sites: [sail.id], roles: ["admin", "editor", "viewer"], sort: 0 },
    { title: "ESR", description: "Electronic Staff Record - payslips and leave.", url: "https://my.esr.nhs.uk",
      sites: [sail.id, cssc.id], roles: ["admin", "editor", "viewer"], sort: 1 },
    { title: "Eventbrite organiser", description: "Manage the centre's public listings.", url: "https://www.eventbrite.co.uk",
      sites: [sail.id], roles: ["admin", "editor"], sort: 2 },
    { title: "Finance portal", description: "Purchase orders and approvals.", url: "https://example.com/finance",
      sites: [sail.id, cssc.id], roles: ["admin"], sort: 3 },
  ]);
  console.log("apps: 4");
  console.log("Done.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
