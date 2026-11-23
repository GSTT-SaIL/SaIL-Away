// The board's server routes, in one Edge Function (was pocketbase/pb_hooks).
// Called as https://<project>.supabase.co/functions/v1/api/<route>.
//
// Public (no sign-in - each is a deliberate hole, so it sends only what it
// must, picked field by field):
//   GET  /availability?site=<code>          rooms + when they're busy, nothing else
//   GET  /forms/public/<code>               one form's questions
//   POST /forms/public/<code>               one response, checked against the form
//   GET  /public/courses/upcoming           the staff course list (X-Link: <token>)
// Signed in (Authorization: Bearer <the person's token>):
//   GET  /eventbrite/events?site=           upcoming events and sign-ups
//   GET  /eventbrite/events/<id>/attendees?site=
//   GET  /eventbrite/create-info?site=      admins and the site's editors
//   POST /eventbrite/upload-slot?site=
//   POST /eventbrite/create?site=           {dry: true} builds every call, sends none
//   POST /eventbrite/delete?site=           only drafts the board made
//
// The function runs with the service key, past row-level security, so every
// route checks who's asking itself. Eventbrite tokens come from
// site_secrets and never leave the server.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.119.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
function serviceKey(): string {
  // New-style secret keys come as JSON ({"default": "sb_secret_..."}); fall
  // back to the legacy service role key.
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    if (keys.default) return keys.default;
  } catch { /* not set */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const db: SupabaseClient = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false } });

const EB = "https://www.eventbriteapi.com/v3";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-link, x-client-info",
  "Access-Control-Max-Age": "86400",
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Today in the UK, YYYY-MM-DD.
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

/* ------------------------------------------------------------ who's asking */

type Person = { id: string; role: string; sites: string[]; name: string };

async function person(req: Request): Promise<Person> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.startsWith("sb_")) throw new HttpError(401, "Please sign in.");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Please sign in.");
  const { data: p } = await db.from("profiles").select("id,role,sites,name").eq("id", data.user.id).maybeSingle();
  if (!p) throw new HttpError(401, "This account has no profile.");
  return p as Person;
}

const holds = (p: Person, site: string) => p.role === "admin" || (p.sites || []).includes(site);
const mayCreate = (p: Person, site: string) => p.role === "admin" || (p.role === "editor" && (p.sites || []).includes(site));

async function siteWithSecrets(id: string) {
  if (!id) return null;
  const { data } = await db.from("sites").select("*, site_secrets(*)").eq("id", id).maybeSingle();
  if (!data) return null;
  const s = Array.isArray(data.site_secrets) ? data.site_secrets[0] : data.site_secrets;
  return { ...data, token: s?.eventbrite_token || "", org: s?.eventbrite_org || "", staffCode: s?.eventbrite_staff_code || "" };
}

/* ------------------------------------------------------------ Eventbrite */

async function ebGet(token: string, path: string, params: Record<string, string> = {}) {
  const u = new URL(EB + path);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Eventbrite ${res.status}: ${body.error_description || body.error || "HTTP " + res.status}`);
  return body;
}

async function orgOf(token: string, org: string) {
  if (org) return org;
  const orgs = (await ebGet(token, "/users/me/organizations/")).organizations || [];
  if (!orgs.length) throw new Error("This token has no organizations attached to it.");
  return orgs[0].id as string;
}

const NO_TOKEN = "This site has no Eventbrite account set up. A superuser can add its token in Supabase Studio (site_secrets).";

async function ebEvents(req: Request, url: URL) {
  const p = await person(req);
  const site = await siteWithSecrets(url.searchParams.get("site") || "");
  if (!site || !holds(p, site.id)) return json(404, { error: "No such site." });
  if (!site.token) return json(500, { error: NO_TOKEN });
  try {
    const org = await orgOf(site.token, site.org);
    const page = await ebGet(site.token, `/organizations/${org}/events/`, { order_by: "start_asc", status: "live", expand: "venue,ticket_classes" });
    const now = Date.now();
    const events = [];
    for (const ev of page.events || []) {
      const start = ev.start || {}, end = ev.end || {};
      const finishes = new Date(end.utc || start.utc).getTime();
      if (!isNaN(finishes) && finishes < now) continue;
      const classes = (ev.ticket_classes || []).filter((t: any) => !t.hidden);
      const sold = classes.reduce((n: number, t: any) => n + (t.quantity_sold || 0), 0);
      const allocated = classes.reduce((n: number, t: any) => n + (t.quantity_total || 0), 0);
      const venue = ev.venue || {}, address = venue.address || {};
      events.push({
        id: ev.id, name: ev.name?.text || "Untitled event", start: start.local || null, end: end.local || null,
        online: !!ev.online_event, venue: venue.name || address.localized_address_display || null, url: ev.url,
        capacity: ev.capacity ?? (allocated || null), signedUp: classes.length ? sold : null,
      });
    }
    return json(200, { events });
  } catch (err) {
    console.error("Eventbrite events lookup failed", String(err));
    return json(502, { error: String((err as Error).message || err) });
  }
}

async function ebAttendees(req: Request, url: URL, eventId: string) {
  const p = await person(req);
  const site = await siteWithSecrets(url.searchParams.get("site") || "");
  if (!site || !holds(p, site.id)) return json(404, { error: "No such site." });
  if (!site.token) return json(500, { error: NO_TOKEN });
  if (!/^[0-9]+$/.test(eventId)) return json(400, { error: "Invalid event id." });
  // Eventbrite sometimes sends names as Python byte strings: b'Jo'.
  const unmangle = (n: unknown) => typeof n === "string" ? n.replace(/b'([^']*)'/g, "$1").replace(/b"([^"]*)"/g, "$1").trim() : "";
  try {
    const out = [];
    let continuation = "";
    do {
      const page = await ebGet(site.token, `/events/${eventId}/attendees/`, continuation ? { continuation } : {});
      for (const a of page.attendees || []) {
        const pr = a.profile || {};
        const composed = [pr.first_name, pr.last_name].filter(Boolean).join(" ");
        out.push({
          id: a.id, name: composed || unmangle(pr.name) || "Unnamed", email: pr.email || null,
          ticket: a.ticket_class_name || null, status: a.status || null, checkedIn: !!a.checked_in, cancelled: !!a.cancelled,
        });
      }
      continuation = page.pagination?.has_more_items ? page.pagination.continuation : "";
    } while (continuation);
    return json(200, { attendees: out });
  } catch (err) {
    console.error("Eventbrite attendees lookup failed", String(err), eventId);
    return json(502, { error: String((err as Error).message || err) });
  }
}

async function ebCreateInfo(req: Request, url: URL) {
  const p = await person(req);
  const site = await siteWithSecrets(url.searchParams.get("site") || "");
  if (!site || !mayCreate(p, site.id)) return json(403, { error: "You can't create events for this site." });
  const { data } = await db.from("eb_images").select("key").eq("site", site.id);
  const images: Record<string, boolean> = {};
  for (const r of data || []) images[r.key] = true;
  return json(200, { ready: !!site.token, images });
}

async function ebUploadSlot(req: Request, url: URL) {
  const p = await person(req);
  const site = await siteWithSecrets(url.searchParams.get("site") || "");
  if (!site || !mayCreate(p, site.id)) return json(403, { error: "You can't create events for this site." });
  if (!site.token) return json(400, { error: "This site has no Eventbrite account set up." });
  const res = await fetch(EB + "/media/upload/?type=image-event-logo", { headers: { Authorization: "Bearer " + site.token } });
  const s = await res.json().catch(() => ({}));
  if (!res.ok) return json(502, { error: `Eventbrite ${res.status}: ${s.error_description || s.error || ""}` });
  return json(200, { upload_url: s.upload_url, upload_data: s.upload_data || {},
    file_parameter_name: s.file_parameter_name || "file", upload_token: s.upload_token });
}

// The fixed course "template": every course gets these tickets, questions
// and settings. The browser sends only which tickets, places and the
// external price - names, paid/free and hidden come from here.
const CATEGORY_ID = "107", FORMAT_ID = "9", MAX_PER_ORDER = 1;
const TICKETS: Record<string, { name: string; paid: boolean; hidden: boolean }> = {
  ext: { name: "Non-GSTT (External)", paid: true, hidden: false },
  int: { name: "GSTT Staff", paid: false, hidden: true },
  med: { name: "GSTT Staff - Medical", paid: false, hidden: true },
  nur: { name: "GSTT Staff - Nursing", paid: false, hidden: true },
  ahp: { name: "GSTT Staff - AHP", paid: false, hidden: true },
};
const QUESTIONS = [
  { q: "Dietary requirements", type: "text", req: false, for: ["ext", "int", "med", "nur", "ahp"] },
  { q: "Access requirements", type: "text", req: false, for: ["ext", "int", "med", "nur", "ahp"] },
  { q: "Department or ward", type: "text", req: true, for: ["int", "med", "nur", "ahp"] },
  { q: "How did you hear about this course?", type: "radio", req: false, for: ["ext"],
    choices: ["Colleague", "Email", "Social media", "Website", "Other"] },
];
// Eventbrite's built-in questions: [canned type, label, tickets (all if absent)].
const STANDARD: [string, string, string[]?][] = [["job_title", "Job title"], ["company", "Organisation", ["ext"]], ["cell_phone", "Mobile phone"]];

async function ebCreate(req: Request, url: URL) {
  const who = await person(req);
  const site = await siteWithSecrets(url.searchParams.get("site") || "");
  if (!site || !mayCreate(who, site.id)) return json(403, { error: "You can't create events for this site." });
  const p = await req.json().catch(() => ({})) as any;
  const dry = !!p.dry;
  if (!site.token && !dry) return json(400, { error: NO_TOKEN });

  const esc = (s: unknown) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
  const title = String(p.title || "").trim();
  const online = p.loc === "online";
  const venues = Array.isArray(site.eventbrite_venues) ? site.eventbrite_venues : [];
  const venueIds = new Set(venues.filter((v: any) => v && v.id).map((v: any) => String(v.id)));
  const dates: any[] = Array.isArray(p.dates) ? p.dates : [];
  const tickets: { id: string; name: string; paid: boolean; hidden: boolean; places: number; price: number }[] = [];
  for (const t of Array.isArray(p.tickets) ? p.tickets : []) {
    const def = TICKETS[t?.id];
    if (!def || !t.on) continue;
    tickets.push({ id: t.id, ...def, places: Math.floor(Number(t.places) || 0), price: def.paid ? Number(t.price) || 0 : 0 });
  }
  const bad: string[] = [];
  if (!title || title.length > 75) bad.push("a title (up to 75 characters)");
  if (String(p.summary || "").length > 140) bad.push("a summary of up to 140 characters");
  if (!dates.length || dates.length > 20) bad.push("1 to 20 dates");
  if (!tickets.length) bad.push("at least one ticket");
  tickets.forEach((t) => { if (t.places < 1 || t.places > 10000 || (t.paid && !(t.price > 0))) bad.push("places (and a price) for " + t.name); });
  dates.forEach((d, i) => {
    if (!UTC.test(d.start_utc || "") || !UTC.test(d.end_utc || "") || !UTC.test(d.sales_end_utc || "") || d.end_utc <= d.start_utc)
      bad.push("a start and end for date " + (i + 1));
    if (!online && !venueIds.has(String(d.venue || ""))) bad.push("one of this site's venues for date " + (i + 1));
  });
  if (bad.length) return json(400, { error: "Needs " + bad.join(", ") + "." });

  // Every Eventbrite call goes through here; a dry run builds it and stops.
  async function call(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
    if (dry) return { ok: true, data: { id: "NEW" } };
    const headers: Record<string, string> = { Authorization: "Bearer " + site!.token };
    if (body !== undefined) headers["Content-Type"] = "application/json";   // never on a GET (Eventbrite then ignores the query)
    try {
      const res = await fetch(EB + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
                                           signal: AbortSignal.timeout(60_000) });
      const b = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, data: b };
      return { ok: false, data: (`HTTP ${res.status} ${b.error || ""}: ${b.error_description || ""}`).trim() };
    } catch (err) { return { ok: false, data: String(err) }; }
  }
  const mark = (ok: boolean) => dry ? "plan" : ok ? "ok" : "fail";

  let org = site.org;
  if (!org && !dry) {
    const r = await call("GET", "/users/me/organizations/");
    org = r.ok && r.data.organizations?.length ? r.data.organizations[0].id : "";
    if (!org) return json(502, { error: "Couldn't find this site's Eventbrite organisation." });
  }

  // The image: a library one already on Eventbrite is reused; otherwise
  // the browser has uploaded it to Eventbrite's storage, and we register
  // it with a centred 2:1 crop.
  const pre: { step: string; status: string; detail: string }[] = [];
  let imageId = "";
  const img = p.image || {};
  if (img.key) {
    const { data } = await db.from("eb_images").select("media_id").eq("site", site.id).eq("key", String(img.key)).maybeSingle();
    if (data) {
      imageId = data.media_id;
      pre.push({ step: "Image", status: dry ? "plan" : "ok", detail: "Already on Eventbrite, reused (id " + imageId + ")" });
    }
  }
  if (!imageId && (img.upload_token || dry)) {
    const w = Math.floor(Number(img.w) || 0), h = Math.floor(Number(img.h) || 0);
    const body: any = { upload_token: String(img.upload_token || "(the browser's upload)") };
    if (w && h) {
      const ch = Math.min(h, Math.floor(w / 2)), cw = ch * 2;
      body.crop_mask = { top_left: { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2) }, width: cw, height: ch };
    }
    const r = await call("POST", "/media/upload/", body);
    if (r.ok && !dry) {
      imageId = String(r.data.id || "");
      if (img.key && imageId) await db.from("eb_images").upsert({ site: site.id, key: String(img.key), media_id: imageId }, { onConflict: "site,key", ignoreDuplicates: true });
    }
    pre.push({ step: "Image", status: mark(r.ok), detail: dry
      ? "Would upload " + (img.name || "the chosen image") + " once and crop it to 2:1" + (img.key ? ", then reuse it next time" : "")
      : r.ok ? "Uploaded and cropped to 2:1 (id " + imageId + ")" : "Registering the upload: " + r.data });
  }
  if (!imageId && !dry && !pre.length) pre.push({ step: "Image", status: "skip", detail: "No image was sent" });

  const results = [];
  const places = tickets.reduce((s, t) => s + t.places, 0);
  const organizer = site.eventbrite_organizer || "";
  for (const [n, d] of dates.entries()) {
    const steps: { step: string; status: string; detail: string }[] = [];
    const log = (step: string, status: string, detail = "") => steps.push({ step, status, detail });
    const ev: any = { name: { html: esc(title) }, summary: String(p.summary || ""),
      start: { timezone: "Europe/London", utc: d.start_utc }, end: { timezone: "Europe/London", utc: d.end_utc },
      currency: "GBP", online_event: online, listed: true, shareable: true, capacity: places,
      show_remaining: true, hide_end_date: false, category_id: CATEGORY_ID, format_id: FORMAT_ID };
    if (!online) ev.venue_id = String(d.venue);
    if (organizer) ev.organizer_id = organizer;
    const made = await call("POST", `/organizations/${org}/events/`, { event: ev });
    if (!made.ok) { log("Create draft event", "fail", made.data); results.push({ date: n + 1, steps }); continue; }
    const eid = String(made.data.id);
    if (!dry) await db.from("eb_created").insert({ site: site.id, event_id: eid, title, start: d.start_utc, created_by: who.id });
    log("Create draft event", mark(true), "Title, summary, dates, UK time, " + (online ? "online" : "venue") +
      ", category, format, capacity " + places + (organizer ? ", the site's organiser profile" : ", the account's default organiser"));

    let html = String(p.about || "").split("\n").filter((l) => l.trim()).map((l) => "<p>" + esc(l) + "</p>").join("");
    if (d.daily) html = "<p><strong>" + esc(d.daily) + "</strong></p>" + html;
    if (html) {
      const r = await call("POST", `/events/${eid}/structured_content/1/`,
        { modules: [{ type: "text", data: { body: { type: "text", text: html, alignment: "left" } } }], publish: true, purpose: "listing" });
      log("Description", mark(r.ok), r.ok ? "About this course" + (d.daily ? " and daily times" : "") : r.data);
    } else log("Description", "skip", "About this course was empty");

    if (imageId || (dry && (img.key || img.upload_token || img.name))) {
      const r = await call("POST", `/events/${eid}/`, { event: { logo_id: imageId || "IMAGE" } });
      log("Main image", mark(r.ok), r.ok ? "Set as the event's image" : r.data);
    }

    const tc: Record<string, string> = {};
    const codes: { ticket: string; code: string }[] = [];
    for (const t of tickets) {
      const body: any = { name: t.name, quantity_total: t.places, minimum_quantity: 1, maximum_quantity: MAX_PER_ORDER,
        hidden: t.hidden, sales_end: d.sales_end_utc };
      if (t.paid) { body.cost = "GBP," + Math.round(t.price * 100); body.include_fee = false; } else body.free = true;
      const r = await call("POST", `/events/${eid}/ticket_classes/`, { ticket_class: body });
      if (r.ok) tc[t.id] = String(r.data.id);
      log("Ticket: " + t.name, mark(r.ok), r.ok ? (t.paid ? "£" + t.price : "Free") + ", " + t.places + " places" +
        (t.hidden ? ", hidden" : "") + ", max " + MAX_PER_ORDER + " per order, sales close a day before" : r.data);
    }

    // One access code per site, the same on every course, revealing every
    // hidden staff ticket.
    const staff = tickets.filter((t) => t.hidden && tc[t.id]);
    if (staff.length && !site.staffCode) log("Staff access code", "fail", "This site has no staff code - a superuser can set one in Supabase Studio (site_secrets)");
    else if (staff.length) {
      const r = await call("POST", `/organizations/${org}/discounts/`,
        { discount: { type: "access", code: site.staffCode, event_id: eid, ticket_class_ids: staff.map((t) => tc[t.id]),
          quantity_available: staff.reduce((s, t) => s + t.places, 0) } });
      log("Staff access code", mark(r.ok), r.ok ? site.staffCode + " reveals " + staff.map((t) => t.name).join(", ") : r.data);
      if (r.ok && !dry) codes.push({ ticket: "GSTT staff", code: site.staffCode });
    }

    const s = await call("POST", `/events/${eid}/ticket_buyer_settings/`, { ticket_buyer_settings: { survey_respondent: "attendee" } });
    log("Collect details for each attendee", mark(s.ok), s.ok ? "" : s.data);

    for (const q of QUESTIONS) {
      const ids = q.for.filter((k) => tc[k]).map((k) => tc[k]);
      if (!ids.length) continue;
      const body: any = { question: { question: { html: esc(q.q) }, type: q.type, required: q.req, respondent: "attendee",
        ticket_classes: ids.map((i) => ({ id: i })) } };
      if (q.choices) body.question.choices = q.choices.map((c) => ({ answer: { html: c } }));
      const r = await call("POST", `/events/${eid}/questions/`, body);
      log("Question: " + q.q, mark(r.ok), r.ok ? "Asked for " + tickets.filter((t) => q.for.includes(t.id)).map((t) => t.name).join(", ") : r.data);
    }
    for (const [canned, label, forTickets] of STANDARD) {
      const only = forTickets ? forTickets.filter((k) => tc[k]) : null;
      if (only && !only.length) continue;                     // none of its tickets on this course
      const q: any = { question: { html: label }, type: "text", respondent: "attendee", required: false, canned_type: canned };
      if (only) q.ticket_classes = only.map((k) => ({ id: tc[k] }));
      const r = await call("POST", `/events/${eid}/canned_questions/`, { question: q });
      log("Standard question: " + label, mark(r.ok), r.ok
        ? (only ? "Asked for " + tickets.filter((t) => only.includes(t.id)).map((t) => t.name).join(", ") : "Asked of each attendee")
        : r.data);
    }
    log("Refund policy (7 days)", "manual", "No API for this - set it by hand in Eventbrite");
    log("Waitlist", "manual", "No API for this - set it by hand in Eventbrite");
    results.push({ date: n + 1, event_id: dry ? "" : eid, link: dry ? "" : "https://www.eventbrite.co.uk/myevent?eid=" + eid, codes, steps });
  }
  return json(200, { dry, image: pre, courses: results });
}

async function ebDelete(req: Request, url: URL) {
  const p = await person(req);
  const site = await siteWithSecrets(url.searchParams.get("site") || "");
  if (!site || !mayCreate(p, site.id)) return json(403, { error: "You can't change events for this site." });
  const body = await req.json().catch(() => ({})) as any;
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x: string) => /^[0-9]+$/.test(x)).slice(0, 50);
  const out = [];
  for (const eid of ids) {
    const { data: rec } = await db.from("eb_created").select("id").eq("site", site.id).eq("event_id", eid).maybeSingle();
    if (!rec) { out.push({ id: eid, ok: false, detail: "Not made by the board here, so not deleted" }); continue; }
    const res = await fetch(`${EB}/events/${eid}/`, { method: "DELETE", headers: { Authorization: "Bearer " + site.token },
                                                      signal: AbortSignal.timeout(30_000) });
    if (res.ok) await db.from("eb_created").delete().eq("id", rec.id);
    out.push({ id: eid, ok: res.ok, detail: res.ok ? "" : "HTTP " + res.status });
  }
  return json(200, { deleted: out });
}

/* ------------------------------------------------------------ public: availability */

// A site's rooms and when they're booked - room, date, start, end and
// nothing else. Window: 8 weeks back to 31 March at the end of next
// financial year (the page works the same out; keep them in step).
async function availability(url: URL) {
  const code = (url.searchParams.get("site") || "").trim().toLowerCase();
  const q = db.from("sites").select("id,name,full_name,colour,logo");
  const { data: site } = await (code ? q.eq("code", code) : q.order("sort").limit(1)).maybeSingle();
  if (!site) return json(404, { error: "No such site." });
  const { data: rooms } = await db.from("rooms").select("name").eq("site", site.id).order("sort");
  const today = londonToday();
  const [y, m] = today.split("-").map(Number);
  const fy = m >= 4 ? y : y - 1;
  const from = new Date(Date.now() - 63 * 86400000).toISOString().slice(0, 10);
  const to = `${fy + 2}-03-31`;
  const { data: sessions, error } = await db.from("sessions").select("room,date,start,end")
    .eq("site", site.id).gte("date", from).lte("date", to);
  if (error) { console.error("Public availability lookup failed", error.message); return json(500, { error: "Could not load availability." }); }
  const busy = (sessions || []).filter((s) => s.room && s.date && s.start && s.end)
    .map((s) => ({ room: s.room, date: s.date, start: s.start, end: s.end }));
  return json(200, {
    site: { name: site.name, full_name: site.full_name, colour: site.colour, logo: site.logo },
    rooms: (rooms || []).map((r) => r.name), busy,
  });
}

/* ------------------------------------------------------------ public: forms */

async function formByCode(code: string) {
  if (code.length < 16 || !/^[a-z0-9]+$/.test(code)) return null;
  const { data } = await db.from("forms").select("id,title,open,closes,settings,questions").eq("code", code).maybeSingle();
  return data;
}
const isOpen = (f: any) => f.open && !(f.closes && londonToday() > f.closes);

async function formGet(code: string) {
  const f = await formByCode(code);
  if (!f) return json(404, { error: "This form doesn't exist." });
  const s = f.settings || {};
  return json(200, {
    title: f.title, intro: String(s.intro || ""), submitLabel: String(s.submitLabel || ""), thanks: String(s.thanks || ""),
    anonymous: !!s.anonymous, open: isOpen(f), questions: Array.isArray(f.questions) ? f.questions : [],
  });
}

const clientIp = (req: Request) =>
  req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

async function formPost(req: Request, code: string) {
  const LIMITS: Record<string, number> = { text: 500, long: 5000, email: 254 };
  if (Number(req.headers.get("content-length") || 0) > 64 * 1024) return json(413, { error: "That's too long to send." });
  const raw = await req.text();
  if (raw.length > 64 * 1024) return json(413, { error: "That's too long to send." });

  // 5 a minute per address.
  const ip = clientIp(req);
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("form_rate").select("ip", { count: "exact", head: true }).eq("ip", ip).gte("at", since);
  if ((count || 0) >= 5) return json(429, { error: "Too many sends - please wait a minute and try again." });
  await db.from("form_rate").insert({ ip });
  if (Math.random() < 0.05) await db.from("form_rate").delete().lt("at", new Date(Date.now() - 3600_000).toISOString());

  const f = await formByCode(code);
  if (!f) return json(404, { error: "This form doesn't exist." });
  if (!isOpen(f)) return json(400, { error: "This form is closed." });

  let body: any = {};
  try { body = JSON.parse(raw || "{}"); } catch { return json(400, { error: "That didn't arrive properly - please try again." }); }
  // Spam: the hidden field filled in, or sent under 2 seconds after loading -
  // answered "ok" so a bot learns nothing, and not saved.
  if (body.website || !(Number(body.t) >= 2000)) return json(200, { ok: true });

  const questions: any[] = Array.isArray(f.questions) ? f.questions : [];
  const given = body.answers && typeof body.answers === "object" ? body.answers : {};
  const answers: Record<string, unknown> = {}, labels: Record<string, string> = {};
  const missing: string[] = [], invalid: string[] = [];
  const isBlank = (v: unknown) => v === undefined || v === null || v === "" || v === false;
  for (const q of questions) {
    if (!q || !q.id || q.type === "info") continue;
    if (q.showIf && q.showIf.q && String(answers[q.showIf.q] ?? "") !== String(q.showIf.value)) continue;
    let v: any = given[q.id];
    if (q.type === "yesno") v = v === true || v === "true";
    else if (v === undefined || v === null) v = "";
    else v = String(v).trim();
    if (isBlank(v)) { if (q.required) missing.push(q.label); continue; }
    let ok = true;
    if (q.type === "text" || q.type === "long") ok = v.length <= LIMITS[q.type];
    else if (q.type === "email") ok = v.length <= LIMITS.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    else if (q.type === "number") ok = v.length <= 30 && isFinite(Number(v));
    else if (q.type === "date") ok = /^\d{4}-\d{2}-\d{2}$/.test(v);
    else if (q.type === "choice") ok = (q.options || []).includes(v);
    else if (q.type !== "yesno") ok = false;
    if (!ok) { invalid.push(q.label); continue; }
    answers[q.id] = v;
    labels[q.id] = String(q.label || "");
  }
  if (missing.length) return json(400, { error: "Please answer every required question.", missing });
  if (invalid.length) return json(400, { error: "Some answers aren't valid.", invalid });
  const { error } = await db.from("form_responses").insert({ form: f.id, answers, labels });
  if (error) { console.error("Saving a form response failed", error.message); return json(500, { error: "Couldn't save that - please try again." }); }
  return json(200, { ok: true });
}

/* ------------------------------------------------------------ public: course list */

const COURSES_TTL = 300_000;

async function publicCourses(req: Request) {
  const token = String(req.headers.get("X-Link") || "");
  let ok = false;
  if (/^[A-Za-z0-9]{32,64}$/.test(token)) {
    const { data } = await db.from("pub_courses_links").select("expires").eq("token", token).eq("active", true).maybeSingle();
    ok = !!data && (!data.expires || new Date(data.expires).getTime() > Date.now());
  }
  if (!ok) return json(404, { error: "This link isn't valid. Ask for a new one." });

  const { data: cached } = await db.from("cache").select("value,expires").eq("key", "pub_courses_upcoming").maybeSingle();
  if (cached && new Date(cached.expires).getTime() > Date.now()) return json(200, cached.value);

  const { data: s } = await db.from("sites").select("id").eq("code", "sail").maybeSingle();
  const site = s ? await siteWithSecrets(s.id) : null;
  if (!site?.token) return json(503, { error: "The course list isn't set up yet." });
  try {
    const org = await orgOf(site.token, site.org);
    const events: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const d = await ebGet(site.token, `/organizations/${org}/events/`, { status: "live", time_filter: "current_future",
        order_by: "start_asc", expand: "venue,ticket_availability", page_size: "50", page: String(page) });
      events.push(...(d.events || []));
      if (!d.pagination?.has_more_items) break;
    }
    const courses = events.map((x) => {
      const ta = x.ticket_availability || {}, lo = ta.minimum_ticket_price || {}, hi = ta.maximum_ticket_price || {};
      return {
        name: x.name?.text || "", summary: x.summary || "", start: x.start?.local || "", end: x.end?.local || "",
        online: !!x.online_event, venue: x.venue?.name || "", url: x.url || "", image: x.logo?.url || "",
        sold_out: !!ta.is_sold_out, price_min: Number(lo.major_value || 0), price_max: Number(hi.major_value || 0),
      };
    });
    const data = { updated: new Date().toISOString(), courses };
    await db.from("cache").upsert({ key: "pub_courses_upcoming", value: data, expires: new Date(Date.now() + COURSES_TTL).toISOString() });
    return json(200, data);
  } catch (err) {
    console.error("Public course list failed", String(err));
    return json(502, { error: "The course list could not be loaded just now." });
  }
}

/* ------------------------------------------------------------ routing */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  // The path after the function's name: /functions/v1/api/x -> /x
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, "") || "/";
  const m = req.method;
  let r: RegExpMatchArray | null;
  try {
    if (m === "GET" && path === "/availability") return await availability(url);
    if ((r = path.match(/^\/forms\/public\/([^/]+)$/))) {
      const code = decodeURIComponent(r[1]);
      if (m === "GET") return await formGet(code);
      if (m === "POST") return await formPost(req, code);
    }
    if (m === "GET" && path === "/public/courses/upcoming") return await publicCourses(req);
    if (m === "GET" && path === "/eventbrite/events") return await ebEvents(req, url);
    if (m === "GET" && (r = path.match(/^\/eventbrite\/events\/([^/]+)\/attendees$/))) return await ebAttendees(req, url, r[1]);
    if (m === "GET" && path === "/eventbrite/create-info") return await ebCreateInfo(req, url);
    if (m === "POST" && path === "/eventbrite/upload-slot") return await ebUploadSlot(req, url);
    if (m === "POST" && path === "/eventbrite/create") return await ebCreate(req, url);
    if (m === "POST" && path === "/eventbrite/delete") return await ebDelete(req, url);
    return json(404, { error: "Not found." });
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message });
    console.error("Unexpected error", path, String(err));
    return json(500, { error: "Something went wrong on the server." });
  }
});
