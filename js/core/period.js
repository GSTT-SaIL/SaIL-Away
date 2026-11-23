/* The financial year on show - the banner's selector (core/shell.js).

   The whole board shows one financial year at a time: 1 April to 31 March,
   labelled "2026/27" (the user's call, 2026-10-03). It's a viewing scope,
   not a security boundary - the server's rules don't change with it.

   Views never work the period out for themselves: they read `period` and
   use the helpers below, so "what's in the year" is decided in one place.
   Dates are ISO "YYYY-MM-DD" strings throughout, which compare correctly as
   strings - the same form sessions.date and invoices.date are stored in.

   What belongs to a year (docs/ARCHITECTURE.md, "Financial year"):
     session  - its date
     course   - has a session in the year, or has no sessions at all yet
                (so a new course is always reachable); see core/data.js
     invoice  - its own date field; one without a date, the year it was
                created in (views/invoices.js)
     event    - its start date (Tickets) */
import { TODAY, toISO, shortDate } from "./util.js";

// The financial year a date falls in, by the calendar year it starts in:
// 3 October 2026 -> 2026 (2026/27); 3 February 2027 -> 2026 as well.
export const fyOf = d => d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
export const fyOfISO = iso => { const [y, m] = iso.split("-").map(Number); return m >= 4 ? y : y - 1; };
export const fyLabel = y => y + "/" + String((y + 1) % 100).padStart(2, "0");
export const CURRENT_FY = fyOf(TODAY);

// Mutated in place (never reassigned), like the data stores, so every
// importer sees the current year.
export const period = { year: 0, start: "", end: "", label: "" };

export function setPeriod(year){
  period.year = year;
  period.start = year + "-04-01";
  period.end = (year + 1) + "-03-31";
  period.label = fyLabel(year);
}

// The year to open on: the person's last choice (core/prefs.js "fy", set by
// the shell - it follows them, the user's call 2026-10-09), else this one.
export function initialYear(saved){
  const y = parseInt(saved, 10);
  return Number.isFinite(y) && y > 1900 && y < 3000 ? y : CURRENT_FY;
}

export const inPeriod = iso => !!iso && iso >= period.start && iso <= period.end;
export const clampISO = iso => iso < period.start ? period.start : iso > period.end ? period.end : iso;
// A sensible date inside the year for something new: today, if today is in
// it, otherwise the nearest end of the year.
export const defaultISO = () => clampISO(toISO(TODAY));
export const todayInPeriod = () => inPeriod(toISO(TODAY));

// PocketBase stores created/updated as UTC "YYYY-MM-DD HH:MM:SS.sssZ". The
// year's bounds as timestamps, for records filed by when they were made.
// (UTC: something made in the first hour of 1 April BST counts as March.)
export const periodStamps = () => ({ from: period.start + " 00:00:00.000Z", to: period.end + " 23:59:59.999Z" });

// What to tell someone who picks a date outside the year.
export const outsideMessage = iso =>
  `${shortDate(iso)} ${iso.slice(0, 4)} is outside the ${period.label} financial year. ` +
  `To use it, switch the year at the top right first.`;

setPeriod(CURRENT_FY);   // until sign-in reads the person's own (shell.js boot)
