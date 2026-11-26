/* "Create event" - the standalone Eventbrite course form app
   (a standalone Eventbrite course form app) built into the
   board as an item pop-up, opened from the Tickets page (the user's ask,
   2026-10-14). One Eventbrite DRAFT per date, never published; the calls
   are made by pb_hooks/eventbrite_create.pb.js with the site's own token.

   The form as the team shaped it: in person / online, title, summary, about
   this course, a main image (the 10 backgrounds in assets/eventbrite/, or
   your own), the standard ticket set (tick, places, the external price),
   and one card per date. Live checks block or warn. "Check what would be
   sent" is a dry run - every call built, nothing sent. Admins and the
   site's editors (the server checks). */
import { pb } from "../../core/pb.js";
import { esc } from "../../core/util.js";
import { site, siteColour } from "../../core/site.js";
import { openItem } from "../sheet.js";
import { ask } from "../../core/dialog.js";

const TICKETS = [
  { id: "ext",  name: "Non-GSTT (External)",  meta: "Paid, public. Standard price £150", paid: true,  hidden: false, on: true,  price: 150, places: 18 },
  { id: "int",  name: "GSTT Staff",           meta: "Free, access code only",           paid: false, hidden: true,  on: true,  places: 6 },
  { id: "med",  name: "GSTT Staff - Medical", meta: "Free, access code only",           paid: false, hidden: true,  on: false, places: 2 },
  { id: "nur",  name: "GSTT Staff - Nursing", meta: "Free, access code only",           paid: false, hidden: true,  on: false, places: 2 },
  { id: "ahp",  name: "GSTT Staff - AHP",     meta: "Free, access code only",           paid: false, hidden: true,  on: false, places: 2 },
];
const IMAGES = Array.from({ length: 10 }, (_, i) => ({ key: `bg${i + 1}`, thumb: `assets/eventbrite/${i + 1}.jpg`,
  full: `assets/eventbrite/full/${i + 1}.jpg`, name: `Background ${i + 1}` }));
const SALES_CLOSE_DAYS = 1;

// ---- UK time -> the UTC Eventbrite wants (done here: the server has no time zones) ----
function londonOffset(ms){
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000;
}
function londonUTC(date, time){
  const [y, m, d] = date.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall;
  for(let i = 0; i < 2; i++) t = wall - londonOffset(t);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}
const addDaysISO = (iso, n) => { const x = new Date(iso + "T12:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const fmt = d => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function openCreateEvent(){
  let dirty = false, done = false;
  openItem({
    pill: site.current ? { text: site.current.name, bg: `color-mix(in srgb, ${siteColour(site.current)} 13%, #fff)`, fg: siteColour(site.current) } : null,
    title: "New Eventbrite course",
    sub: "Creates one draft per date - nothing is published",
    tabs: ["create"], start: "create",
    fill: { create: (body, isCurrent) => build(body, isCurrent, () => { dirty = true; }, () => { done = true; }) },
    canClose: async () => !dirty || done || await ask("Close the form? What you've filled in will be lost.", { ok: "Close", danger: true }),
  });
}

async function build(body, isCurrent, touched, finished){
  const s = site.current, siteId = s?.id || "";
  const venues = Array.isArray(s?.eventbrite_venues) ? s.eventbrite_venues.filter(v => v && v.id) : [];
  const vname = id => (venues.find(v => String(v.id) === String(id)) || {}).name || id;
  let info = { ready: false, images: {} };
  body.innerHTML = `<p class="loading">Loading&hellip;</p>`;
  try{ info = await pb.send("/api/eventbrite/create-info?site=" + encodeURIComponent(siteId), { requestKey: null }); }
  catch(err){ if(isCurrent()) body.innerHTML = `<p class="loading">${esc(err?.data?.error || err.message || err)}</p>`; return; }
  if(!isCurrent()) return;

  const first = (() => { const d = new Date(); d.setDate(d.getDate() + 14); while([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  body.innerHTML = `<form class="ebf" novalidate>
    ${info.ready ? "" : `<div class="ebwarn">This site has no Eventbrite account set up, so nothing can be created yet - a superuser can add its token to the site in the dashboard. You can still fill this in and check what would be sent.</div>`}
    <section class="fsec">
      <h2>Course</h2>
      <div class="fblock"><span class="flabel">Where</span>
        <div class="seg" role="radiogroup" aria-label="Where">
          <label><input type="radio" name="loc" value="venue" ${venues.length ? "checked" : "disabled"}><span>In person</span></label>
          <label><input type="radio" name="loc" value="online" ${venues.length ? "" : "checked"}><span>Online</span></label>
        </div>
        ${venues.length ? "" : `<p class="fhelp" style="margin-top:6px">No venues set for this site (sites &rarr; eventbrite_venues in the dashboard), so online only.</p>`}
      </div>
      <div class="fblock"><label class="flabel" for="eb-title">Title</label>
        <p class="fhelp">The course name only. Eventbrite shows the date.</p>
        <input class="ed" type="text" id="eb-title" maxlength="75"><span class="count" data-for="eb-title"></span></div>
      <div class="fblock"><label class="flabel" for="eb-summary">Summary</label>
        <p class="fhelp">One sentence, shown under the title and in search.</p>
        <textarea class="ed" id="eb-summary" maxlength="140" rows="2"></textarea><span class="count" data-for="eb-summary"></span></div>
    </section>
    <section class="fsec">
      <h2>Description</h2>
      <div class="fblock"><label class="flabel" for="eb-about">About this course</label>
        <p class="fhelp">Who it's for and what they'll learn.</p>
        <textarea class="ed" id="eb-about" rows="6"></textarea></div>
      <div class="fblock"><span class="flabel">Main image</span>
        <p class="fhelp">Shown at the top of the page and as the thumbnail in search. Previews are cropped to Eventbrite's 2:1 shape.</p>
        <div class="imgs" id="eb-imgs" role="radiogroup" aria-label="Main image"></div>
        <div class="imgup"><button type="button" class="sbtn" id="eb-upbtn">Upload your own</button>
          <input type="file" id="eb-upload" accept="image/jpeg,image/png" hidden>
          <span class="fhelp" style="margin:0">JPG or PNG, ideally 2160 &times; 1080 px, under 10 MB.</span></div></div>
    </section>
    <section class="fsec">
      <h2>Tickets</h2>
      <div class="fblock"><span class="flabel">Ticket types</span>
        <p class="fhelp">The standard set. Tick the ones this course needs and set prices and places.</p>
        <div class="lcard" id="eb-tickets"><div class="trow head"><span></span><span>Ticket</span><span>Price (&pound;)</span><span>Places</span></div>
          ${TICKETS.map(t => `<div class="trow" data-id="${t.id}">
            <input type="checkbox" aria-label="Include ${esc(t.name)}" ${t.on ? "checked" : ""}>
            <div><div class="tname">${esc(t.name)}</div><div class="tmeta">${esc(t.meta)}</div></div>
            ${t.paid ? `<input class="ed price" type="number" aria-label="${esc(t.name)} price" min="0" step="0.01" value="${t.price}">` : `<span class="free">Free</span>`}
            <input class="ed places" type="number" aria-label="${esc(t.name)} places" min="1" value="${t.places}"></div>`).join("")}
        </div></div>
      <div class="fblock" style="max-width:220px"><label class="flabel" for="eb-capacity">Course places</label>
        <input class="ed" type="number" id="eb-capacity" value="0" readonly tabindex="-1"></div>
    </section>
    <section class="fsec">
      <h2>Dates</h2>
      <p class="fhelp" style="margin:0">Each date becomes its own course on Eventbrite, with the details and tickets above.</p>
      <div id="eb-dates" class="dlist"></div>
      <button type="button" class="sbtn" id="eb-adddate" style="align-self:flex-start">+ Add date</button>
    </section>
    <div class="fsubmit">
      <div class="fproblem" id="eb-problems" hidden><h3 id="eb-probtitle"></h3><ul id="eb-problist"></ul>
        <label class="ack" id="eb-ackrow" hidden><input type="checkbox" id="eb-ack"> I've checked these and they're correct</label></div>
      <div class="line">
        <span id="eb-sendwrap"><button type="submit" class="sbtn primary big" id="eb-send">Create draft</button></span>
        <button type="button" class="sbtn" id="eb-dry">Check what would be sent</button>
        <span class="fstatus" id="eb-status" role="status"></span>
      </div>
      <div id="eb-results" hidden></div>
    </div>
  </form>`;

  const f = body.querySelector("form"), $ = sel => body.querySelector(sel);
  let upload = null;       // { name, url, w, h, size, file }
  const sizes = {};        // library key -> { w, h }

  // ---- images ----
  const tile = (im, checked) => `<label><input type="radio" name="eb-img" value="${esc(im.key)}" ${checked ? "checked" : ""} aria-label="${esc(im.name)}">
    <img src="${esc(im.thumb)}" alt="">${im.own ? `<span class="own">Your upload</span>` : ""}<span class="tick">&#10003;</span></label>`;
  function renderImages(sel){
    $("#eb-imgs").innerHTML = (upload ? tile({ key: "own", thumb: upload.url, own: true, name: upload.name }, sel === "own") : "") +
      IMAGES.map(im => tile(im, im.key === sel)).join("");
  }
  $("#eb-upload").addEventListener("change", e => {
    const file = e.target.files[0]; if(!file) return;
    const url = URL.createObjectURL(file), probe = new Image();
    probe.onload = () => { upload = { name: file.name, url, w: probe.naturalWidth, h: probe.naturalHeight, size: file.size, file }; renderImages("own"); update(); };
    probe.src = url;
  });
  const sizeOf = key => sizes[key] || new Promise(res => {
    const im = IMAGES.find(x => x.key === key), probe = new Image();
    probe.onload = () => res(sizes[key] = { w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () => res({ w: 0, h: 0 });
    probe.src = im.full;
  });

  // ---- dates ----
  let seq = 0;
  function dateCard(d){
    const n = ++seq, card = document.createElement("div");
    card.className = "dcard";
    card.innerHTML = `<div class="dhead"><span class="dnum"></span><span class="dsum"></span>
        <button type="button" class="ibtn danger" data-rmdate title="Remove date" aria-label="Remove date">&times;</button></div>
      <div class="dbody"><div class="frow">
        <div class="fblock"><label class="flabel" for="eb-sd${n}">Starts</label><input class="ed sd" type="date" id="eb-sd${n}" value="${d.sd}"></div>
        <div class="fblock"><label class="flabel" for="eb-st${n}">Time</label><input class="ed st" type="time" id="eb-st${n}" value="${d.st}"></div>
        <div class="fblock"><label class="flabel" for="eb-edt${n}">Ends</label><input class="ed edt" type="date" id="eb-edt${n}" value="${d.ed}"></div>
        <div class="fblock"><label class="flabel" for="eb-et${n}">Time</label><input class="ed et" type="time" id="eb-et${n}" value="${d.et}"></div>
      </div>
      <div class="fblock dailyBlock" hidden><label class="flabel" for="eb-dt${n}">Daily times</label>
        <p class="fhelp">Runs over <span class="dayCount"></span> days. Eventbrite shows one span, so say when each day runs. Added to the description.</p>
        <input class="ed daily" type="text" id="eb-dt${n}" value="${esc(d.daily || "")}" ${d.touched ? 'data-touched="1"' : ""}></div>
      <div class="fblock venueBlock"><label class="flabel" for="eb-vn${n}">Venue</label>
        <select class="ed venue" id="eb-vn${n}">${venues.map(v => `<option value="${esc(v.id)}"${String(v.id) === String(d.venue) ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
      </div>`;
    card.querySelector(".daily").addEventListener("input", e => { e.target.dataset.touched = "1"; });
    return card;
  }
  function readDates(){
    return [...body.querySelectorAll("#eb-dates .dcard")].map((c, i) => {
      const v = sel => c.querySelector(sel).value;
      const days = Math.round((new Date(v(".edt")) - new Date(v(".sd"))) / 864e5) + 1;
      return { i: i + 1, card: c, sd: v(".sd"), st: v(".st"), ed: v(".edt"), et: v(".et"), venue: v(".venue"),
        daily: v(".daily"), touched: !!c.querySelector(".daily").dataset.touched, days,
        start: new Date(`${v(".sd")}T${v(".st") || "00:00"}`), end: new Date(`${v(".edt")}T${v(".et") || "00:00"}`),
        el: sel => c.querySelector(sel) };
    });
  }
  function addDate(){
    const ds = readDates(), last = ds[ds.length - 1];
    const d = last ? { ...last, sd: addDaysISO(last.sd, 7), ed: addDaysISO(last.ed, 7) }
                   : { sd: first, st: "09:30", ed: first, et: "16:30", venue: venues[0]?.id || "" };
    $("#eb-dates").append(dateCard(d));
    update();
  }

  function readTickets(){
    return [...body.querySelectorAll("#eb-tickets .trow[data-id]")].map(r => {
      const t = TICKETS.find(x => x.id === r.dataset.id), on = r.querySelector("input[type=checkbox]").checked;
      r.classList.toggle("off", !on);
      r.querySelectorAll("input[type=number]").forEach(i => { i.disabled = !on; });
      const price = r.querySelector(".price");
      return { ...t, on, row: r, priceEl: price, price: price ? +price.value : 0, places: +r.querySelector(".places").value };
    });
  }

  // ---- live checks (the app's, word for word) ----
  function check(tk, dates, loc){
    const out = [], add = (level, msg, ...els) => out.push([level, msg, els]);
    if(!$("#eb-title").value.trim()) add("block", "Add a title.", $("#eb-title"));
    if(!$("#eb-summary").value.trim()) add("warn", "There's no summary. Search results will show the start of the description instead.", $("#eb-summary"));
    const pick = body.querySelector("input[name=eb-img]:checked");
    if(upload && pick?.value === "own"){
      const r = upload.w / upload.h;
      if(upload.size > 10 * 1024 * 1024) add("block", "The uploaded image is over 10 MB.", $("#eb-imgs"));
      if(upload.w < 1080) add("warn", `The uploaded image is only ${upload.w} px wide, so it will look blurry. Aim for 2160 × 1080.`, $("#eb-imgs"));
      if(r < 1.7 || r > 2.3) add("warn", "The uploaded image isn't close to 2:1, so Eventbrite will crop it (as the preview shows).", $("#eb-imgs"));
    }
    if(!pick) add("block", "Choose a main image.", $("#eb-imgs"));
    if(!dates.length) add("block", "Add at least one date.", $("#eb-adddate"));
    for(const d of dates){
      const p = dates.length > 1 ? `Date ${d.i}: ` : "", { start, end, days } = d;
      if(isNaN(start) || isNaN(end)){ add("block", `${p}Fill in the start and end dates and times.`, d.el(".sd"), d.el(".edt")); continue; }
      if(start < new Date()) add("block", `${p}The course starts in the past.`, d.el(".sd"), d.el(".st"));
      if(end <= start) add("block", `${p}The course ends before it starts.`, d.el(".edt"), d.el(".et"));
      if(days > 1 && !d.daily.trim()) add("block", `${p}The course runs over ${days} days. Say when each day runs.`, d.el(".daily"));
      if(days === 1 && (end - start) / 36e5 > 10) add("warn", `${p}Runs ${Math.round((end - start) / 36e5)} hours in one day. Check the times (am and pm).`, d.el(".st"), d.el(".et"));
      if(days > 5) add("warn", `${p}Runs over ${days} days. Check the end date.`, d.el(".edt"));
      if([0, 6].includes(start.getDay())) add("warn", `${p}${start.toLocaleDateString("en-GB", { weekday: "long" })} is a weekend.`, d.el(".sd"));
      const close = new Date(start); close.setDate(close.getDate() - SALES_CLOSE_DAYS);
      if(start >= new Date() && close <= new Date()) add("block", `${p}Ticket sales would already be closed (they close ${fmt(close)}).`, d.el(".sd"));
    }
    for(let a = 0; a < dates.length; a++) for(let b = a + 1; b < dates.length; b++){
      const A = dates[a], B = dates[b];
      if(isNaN(A.start) || isNaN(B.start) || !(A.start < B.end && B.start < A.end)) continue;
      if(A.sd === B.sd && A.st === B.st) add("warn", `Dates ${A.i} and ${B.i} are the same. One may be a copy that wasn't changed.`, B.el(".sd"));
      else if(loc === "venue" && A.venue === B.venue) add("block", `Dates ${A.i} and ${B.i} overlap in ${vname(A.venue)}.`, B.el(".sd"), B.el(".venue"));
    }
    const on = tk.filter(t => t.on);
    if(!on.length) add("block", "Tick at least one ticket type.", $("#eb-tickets"));
    if(on.length && on.every(t => t.hidden)) add("warn", "Every ticket is hidden, so the public can't book.", $("#eb-tickets"));
    for(const t of on){
      if(t.paid && !(t.price > 0)) add("block", `${t.name} is a paid ticket with no price.`, t.priceEl);
      if(!(t.places > 0)) add("block", `${t.name} has no places.`, t.row.querySelector(".places"));
    }
    const ext = on.find(t => t.id === "ext");
    if(ext && ext.price > 0 && ext.price !== 150) add("warn", `Non-GSTT price is £${ext.price}, not the standard £150.`, ext.priceEl);
    return out;
  }

  // Fields are only outlined once someone tries to create (or check) and
  // they're what's blocking it - not the moment the form opens (the user's
  // call, 2026-10-14). Warnings never outline anything.
  // Create stays off until every problem is dealt with (the user's call,
  // 2026-11-02): errors fixed, and warnings fixed or ticked as checked. The
  // tick is for that exact set of warnings - a new or changed one clears it.
  let blocks = 0, tried = false, warnKey = "", ackedFor = "", sent = false;
  function update(){
    const loc = body.querySelector("input[name=loc]:checked").value, dates = readDates();
    for(const d of dates){
      d.el(".venueBlock").hidden = loc !== "venue";
      d.el(".dailyBlock").hidden = !(d.days > 1);
      d.el(".dayCount").textContent = d.days;
      if(d.days > 1 && !d.touched) d.daily = d.el(".daily").value = `Each day ${d.st} to ${d.et}`;
      d.el(".dnum").textContent = `Date ${d.i}`;
      d.el(".dsum").textContent = isNaN(d.start) ? "" :
        d.start.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) +
        (d.days > 1 ? ` to ${d.end.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : `, ${d.st} to ${d.et}`) +
        (loc === "venue" ? ` · ${vname(d.venue)}` : "");
      d.el("[data-rmdate]").hidden = dates.length < 2;
    }
    body.querySelectorAll(".count").forEach(c => { const el = $("#" + c.dataset.for); c.textContent = `${el.value.length} / ${el.maxLength}`; });
    const tk = readTickets(), sum = l => l.reduce((n, t) => n + (t.places > 0 ? t.places : 0), 0);
    $("#eb-capacity").value = sum(tk.filter(t => t.on));

    body.querySelectorAll(".bad").forEach(e => e.classList.remove("bad"));
    const probs = check(tk, dates, loc);
    if(tried) probs.filter(p => p[0] === "block").forEach(([, , els]) => els.forEach(e => e?.classList?.add("bad")));
    blocks = probs.filter(p => p[0] === "block").length;
    warnKey = probs.filter(p => p[0] === "warn").map(p => p[1]).join("|");
    if(ackedFor && ackedFor !== warnKey){ ackedFor = ""; $("#eb-ack").checked = false; }
    const waiting = blocks > 0 || (warnKey !== "" && ackedFor !== warnKey);
    $("#eb-ackrow").hidden = blocks > 0 || !warnKey;
    $("#eb-problems").hidden = !probs.length;
    $("#eb-probtitle").textContent = blocks ? `Fix ${blocks === 1 ? "this" : "these"} before creating` : "Check before creating";
    $("#eb-problist").innerHTML = probs.sort((a, b) => (a[0] === "block" ? -1 : 1) - (b[0] === "block" ? -1 : 1))
      .map(([lvl, msg]) => `<li class="${lvl}"><span class="tag">${lvl === "block" ? "Fix" : "Check"}</span>${esc(msg)}</li>`).join("");
    // Off while anything's waiting; a click on it then shows what's
    // blocking (outlines) - see #eb-sendwrap below. Also off once these
    // drafts are made, until something changes - another click would make
    // them all again.
    $("#eb-send").disabled = !info.ready || waiting || sent;
    $("#eb-send").textContent = dates.length === 1 ? "Create 1 draft" : `Create ${dates.length} drafts`;
  }

  // ---- sending ----
  function payload(dry){
    const loc = body.querySelector("input[name=loc]:checked").value;
    return {
      dry, loc, title: $("#eb-title").value.trim(), summary: $("#eb-summary").value.trim(), about: $("#eb-about").value,
      tickets: readTickets().map(t => ({ id: t.id, on: t.on, price: t.price, places: t.places })),
      dates: readDates().map(d => ({ venue: d.venue, daily: d.days > 1 ? d.daily : "",
        start_utc: londonUTC(d.sd, d.st), end_utc: londonUTC(d.ed, d.et), sales_end_utc: londonUTC(addDaysISO(d.sd, -SALES_CLOSE_DAYS), d.st) })),
    };
  }
  // The chosen image: a library one already on this site's Eventbrite is
  // just named; anything else is uploaded from here, straight to
  // Eventbrite's storage (the server only fetches the signed slot).
  async function image(dry){
    const pick = body.querySelector("input[name=eb-img]:checked")?.value;
    if(!pick) return null;
    if(pick !== "own" && info.images[pick]) return { key: pick };
    const lib = IMAGES.find(x => x.key === pick);
    const name = pick === "own" ? upload.name : lib.name;
    if(dry) return { key: pick === "own" ? "" : pick, name };
    const blob = pick === "own" ? upload.file : await fetch(lib.full).then(r => r.blob());
    const { w, h } = pick === "own" ? upload : await sizeOf(pick);
    const slot = await pb.send("/api/eventbrite/upload-slot?site=" + encodeURIComponent(siteId), { method: "POST", requestKey: null });
    const form = new FormData();
    Object.entries(slot.upload_data || {}).forEach(([k, v]) => form.append(k, v));
    form.append(slot.file_parameter_name || "file", blob, pick === "own" ? upload.name : `${pick}.jpg`);
    // Eventbrite's storage sends no CORS headers: the upload goes, but its
    // reply can't be read - registering it (server side) is the real check.
    await fetch(slot.upload_url, { method: "POST", body: form, mode: "no-cors" });
    return { key: pick === "own" ? "" : pick, upload_token: slot.upload_token, w, h, name };
  }

  async function send(dry){
    if(!dry && !info.ready) return;
    if(blocks){
      tried = true; update();
      $("#eb-status").textContent = blocks === 1 ? "Fix the outlined field first." : `Fix the ${blocks} outlined fields first.`;
      body.querySelector(".bad")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const n = readDates().length;
    $("#eb-send").disabled = $("#eb-dry").disabled = true;
    $("#eb-status").textContent = dry ? "Building every call, sending nothing..." : `Creating ${n === 1 ? "1 draft" : n + " drafts"} on Eventbrite...`;
    try{
      const res = await pb.send("/api/eventbrite/create?site=" + encodeURIComponent(siteId),
        { method: "POST", body: { ...payload(dry), image: await image(dry) }, requestKey: null });
      if(!isCurrent()) return;
      showResults(res);
      $("#eb-status").textContent = dry ? "Nothing was sent - this is what would go." : "Done. Nothing was published.";
      if(!dry){ finished(); sent = true; if(res.image?.some(x => x.status === "ok")) info.images = (await pb.send("/api/eventbrite/create-info?site=" + encodeURIComponent(siteId), { requestKey: null })).images; }
    }catch(err){
      if(isCurrent()) $("#eb-status").textContent = "Couldn't create: " + (err?.data?.error || err.message || err);
    }
    if(isCurrent()){ $("#eb-dry").disabled = false; update(); }
  }

  function showResults(res){
    const pill = st => `<span class="rs ${st}">${{ ok: "Worked", fail: "Failed", manual: "By hand", skip: "Skipped", plan: "Would send" }[st] || st}</span>`;
    const rows = list => list.map(x => `<li>${pill(x.status)}<b>${esc(x.step)}</b>${x.detail ? `<span>${esc(x.detail)}</span>` : ""}</li>`).join("");
    const made = res.courses.filter(c => c.event_id).map(c => c.event_id);
    $("#eb-results").innerHTML =
      (res.image.length ? `<div class="rcard"><h3>Image</h3><ul>${rows(res.image)}</ul></div>` : "") +
      res.courses.map(c => `<div class="rcard"><h3>Date ${c.date}${c.link ? ` &middot; <a href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Open draft in Eventbrite</a>` : ""}</h3>
        ${c.codes?.length ? `<p class="codes">Access codes: ${c.codes.map(x => `<b>${esc(x.ticket)}</b> ${esc(x.code)}`).join(" &middot; ")}</p>` : ""}
        <ul>${rows(c.steps)}</ul></div>`).join("") +
      (made.length ? `<div class="line"><button type="button" class="sbtn danger" id="eb-del">Delete these ${made.length} draft${made.length === 1 ? "" : "s"}</button><span class="fstatus" id="eb-delstatus"></span></div>` : "");
    $("#eb-results").hidden = false;
    $("#eb-del")?.addEventListener("click", async () => {
      if(!await ask(`Delete ${made.length === 1 ? "this draft" : `these ${made.length} drafts`} from Eventbrite for good?`, { ok: "Delete", danger: true })) return;
      $("#eb-del").disabled = true;
      try{
        const out = (await pb.send("/api/eventbrite/delete?site=" + encodeURIComponent(siteId), { method: "POST", body: { ids: made }, requestKey: null })).deleted;
        $("#eb-delstatus").textContent = `${out.filter(o => o.ok).length} of ${out.length} deleted.` + out.filter(o => !o.ok).map(o => ` ${o.id}: ${o.detail}`).join("");
      }catch(err){ $("#eb-delstatus").textContent = "Couldn't delete: " + (err?.data?.error || err.message || err); }
    });
  }

  // ---- wiring ----
  renderImages();
  $("#eb-dates").append(dateCard({ sd: first, st: "09:30", ed: first, et: "16:30", venue: venues[0]?.id || "" }));
  update();
  // A change clears the last status line ("Done", "Nothing was sent ...").
  // It also lets Create run again (a new course from the same form).
  f.addEventListener("input", () => { touched(); sent = false; $("#eb-status").textContent = ""; update(); });
  f.addEventListener("change", () => { touched(); sent = false; $("#eb-status").textContent = ""; update(); });
  f.addEventListener("submit", e => { e.preventDefault(); send(false); });
  // Before the form's own listener re-checks: record which warnings were ticked.
  $("#eb-ack").addEventListener("input", () => { ackedFor = $("#eb-ack").checked ? warnKey : ""; });
  // The disabled button lets clicks through (CSS) to here, so a click on it
  // still outlines what's blocking or points at the tick.
  $("#eb-sendwrap").addEventListener("click", () => {
    if(!$("#eb-send").disabled || !info.ready) return;
    if(sent) $("#eb-status").textContent = "These drafts are made. Change something to create more.";
    else if(blocks) send(false);
    else $("#eb-status").textContent = "Tick that you've checked the warnings above first.";
  });
  $("#eb-dry").addEventListener("click", () => send(true));
  $("#eb-adddate").addEventListener("click", () => { touched(); addDate(); });
  $("#eb-upbtn").addEventListener("click", () => $("#eb-upload").click());
  body.onclick = e => { if(e.target.closest("[data-rmdate]")){ e.target.closest(".dcard").remove(); update(); } };
}
