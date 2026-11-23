/* The room x day grid behind Timetable, Availability and the public
   availability.html page - one painter, so all three always match.

   Pure: it draws what it's given and reads no app state, which is what lets
   the public page use it without the PocketBase SDK or any signed-in data.

   anon = availability mode: every booking shows as "Not Available" with its
   times and nothing else, and nothing is clickable. The public page passes
   bookings that only ever had room/date/start/end in the first place (see
   pb_hooks/availability.pb.js); the board's Availability view passes full
   bookings, so in that mode this function must never output anything but
   room, date and times. */
import { DOW, MON, TODAY, toISO, mins, esc, CHEV } from "./util.js";

const DAY_START = 8*60, DAY_END = 18*60, SPAN = DAY_END - DAY_START;
const HOURS = [8,10,12,14,16,18];
const FALLBACK = { ink:"#4c5560", tint:"#eef0f2" };

export function weekLabel(weekStart, last){
  return weekStart.getDate()+" "+MON[weekStart.getMonth()]+" to "+last.getDate()+" "+MON[last.getMonth()]+" "+last.getFullYear();
}

/* opts:
     days     - Date[] to show as columns (Monday to Sunday; Saturday and
                Sunday get .we, tinted like the Tickets calendar's weekends)
     rooms    - room names, one row each (unbooked rooms still get a row)
     bookings - { room, date, start, end, ...detail }[]
     anon     - availability mode (see above)
     keep     - optional filter: booking => boolean
     groups   - group by id, for booking colours (board only)
     outside  - optional: iso => true for days outside the range on show (the
                board's financial year); drawn greyed and empty
   For several sites at once ("All", core/site.js):
     rooms    - may be { key, name, tag, colour }: the row's key, the room's
                name, a site label under it and the site's colour for both
     roomOf   - booking => the row key it belongs in (default: its room)
     neutral  - every booking plain light grey, not its group's colours
   Board only (never the public page):
     reorder  - up/down arrows on each row's label, shown on hover; they
                carry data-move (-1 / 1) and data-row (the row's key) for
                the view to act on
     flash    - a row key to highlight briefly (the one just moved)
     corner   - the rows' heading, top left (default "Room"; the Rota: "Staff")
   A booking may carry its own second line (`meta`) and hover text (`tip`)
   instead of "title - start to end" (the Rota's leave), and `hatch` to be
   drawn in diagonal stripes of its colour rather than filled (the Rota's
   leave). */
export function paintGrid(el, { days, rooms, bookings, anon, keep = () => true, groups = {}, outside = () => false,
                                roomOf = b => b.room, neutral = false, reorder = false, flash = null, corner = "Room" }){
  const todayISO = toISO(TODAY);
  // One sticky header row (css .hrow) - not a sticky cell per day.
  let html = `<div class="hrow"><div class="corner">${esc(corner)}</div>`;
  days.forEach(d=>{
    const t = toISO(d)===todayISO, o = outside(toISO(d)), w = d.getDay()%6===0;
    html += `<div class="h${t?" today":""}${o?" out":""}${w?" we":""}">
      <span class="dnum">${d.getDate()} ${MON[d.getMonth()].slice(0,3)}</span>
      <span class="dow">${DOW[(d.getDay()+6)%7]}</span></div>`;
  });
  html += `</div>`;

  const axis = HOURS.map(h=>
    `<i style="top:${(h*60-DAY_START)/SPAN*100}%">${String(h).padStart(2,"0")}</i>`).join("");

  // Bookings sorted into their room + day once, so each cell looks up its
  // own instead of searching them all (a year of cells x every booking got
  // slow to redraw with thousands of bookings).
  const slot = new Map();
  bookings.forEach(b=>{
    if(!keep(b)) return;
    const k = roomOf(b) + "|" + b.date;
    (slot.get(k) || slot.set(k, []).get(k)).push(b);
  });

  rooms.forEach((r, ri)=>{
    const { key: room, name, tag, colour } = typeof r === "string" ? { key: r, name: r } : r;
    // The last room's row is closed off with a line under it (css .end).
    const end = ri === rooms.length - 1 ? " end" : "";
    const label = tag
      ? `<span class="rnm" style="--site:${esc(colour || "")}">${esc(name)}</span><span class="sitetag" style="--site:${esc(colour || "")}">${esc(tag)}</span>`
      : esc(name);
    const moves = !reorder ? "" : `<span class="rmove">` +
      `<button type="button" class="rmv up" data-move="-1" data-row="${esc(room)}" aria-label="Move ${esc(name)} up"${ri === 0 ? " disabled" : ""}>${CHEV}</button>` +
      `<button type="button" class="rmv" data-move="1" data-row="${esc(room)}" aria-label="Move ${esc(name)} down"${end ? " disabled" : ""}>${CHEV}</button></span>`;
    html += `<div class="room${end}${flash === room ? " flash" : ""}">${moves}${label}<span class="axis">${axis}</span></div>`;
    days.forEach(d=>{
      const iso = toISO(d), t = iso===todayISO, o = outside(iso), w = d.getDay()%6===0;
      const items = o ? [] : (slot.get(room + "|" + iso) || [])
        .sort((a,b)=>mins(a.start)-mins(b.start));

      // Bookings that overlap in time sit side by side, sharing the width evenly.
      const laneEnds = [], lane = new Map();
      items.forEach(b=>{
        let i = laneEnds.findIndex(e=>e <= mins(b.start));
        if(i === -1){ laneEnds.push(mins(b.end)); i = laneEnds.length-1; }
        else laneEnds[i] = mins(b.end);
        lane.set(b, i);
      });
      const lanes = Math.max(laneEnds.length, 1);

      const blocks = items.map(b=>{
        const s0 = mins(b.start), e0 = mins(b.end);
        const s = Math.max(s0, DAY_START), e = Math.min(e0, DAY_END);
        const top = (s-DAY_START)/SPAN*100;
        const height = Math.max((e-s)/SPAN*100, 0);
        const cut = (s0<DAY_START?" cut-t":"") + (e0>DAY_END?" cut-b":"");
        const box = `top:${top}%;height:${height}%;left:${lane.get(b)*(100/lanes)}%;width:calc(${100/lanes}% - 3px)`;

        if(anon) return `<div class="blk av${cut}" style="${box}">
             <span class="bt">Not Available</span>
             <span class="bm">${esc(b.start)} to ${esc(b.end)}</span>
           </div>`;

        // The course is the headline (bold); the session it's showing here
        // - with its time - sits underneath it, more subtly.
        const g = groups[b.group] || FALLBACK;
        // `hatch`: diagonal stripes of the colour instead of a fill (the
        // Rota's leave, beside its filled course allocations).
        const look = neutral ? "" : b.hatch ? `;--btint:${g.tint};color:${g.ink}` : `;background:${g.tint};color:${g.ink}`;
        return `<button class="blk${cut}${neutral ? " neutral" : ""}${b.hatch ? " hatch" : ""}" data-open="${esc(b.id)}"
             title="${esc(b.tip ?? `${b.courseTitle}: ${b.title}, ${b.start} to ${b.end}`)}"
             style="${box}${look}">
             <span class="bt">${esc(b.courseTitle)}</span>
             <span class="bm">${b.meta !== undefined ? esc(b.meta) : `${esc(b.title)} &middot; ${esc(b.start)}&ndash;${esc(b.end)}`}</span>
           </button>`;
      }).join("");
      html += `<div class="cell${t?" today":""}${o?" out":""}${w?" we":""}${end}"><div class="track">${blocks}</div></div>`;
    });
  });
  el.innerHTML = html;
  el.style.setProperty("--days", days.length);
  el.style.setProperty("--rooms", Math.max(rooms.length, 6));
}
