# Design guide

The one reference for how SaIL-Away looks. **Read this before changing
anything visible, and update it when the user makes a design call** (with
the date, so the reason survives). To see every component drawn with the
real CSS, open **`/styleguide.html`** on the running board (locally:
http://localhost:8080/styleguide.html).

The look: Apple-like, system fonts, white and soft greys, one blue accent,
the SaIL colours only in the banner's logo. Calm, high-contrast enough to read at a
glance, nothing decorative.

---

## 1. Foundations

All of these are CSS custom properties on `:root` in `css/base.css`. **Use
the token, never the raw value** - a new hex colour, radius or font size in
a view's CSS is a bug unless it's in the exceptions below.

### Colour

| Token | Use |
|---|---|
| "All" | Admins' view of every site (view-only; Courses, Timetable, Rota and Staff). Each site's **colour** stands in for group colours: group headers in it with a `.sitetag` pill (the site's name, white on its colour); Timetable room names in it with the pill under them; bookings plain light grey (`.blk.neutral`); the key lists the sites. SaIL's colour is the brand's Magenta Deep `#A81765` (the user's design, 2026-10-07). |
| site wordmark | A site without its own logo (`sites.logo` unticked) shows a **wordmark** in the logo's place: its name, 40px extra-bold in the site's `colour`, its `full_name` under it in 11px grey (the user's pick from a rig, 2026-10-07, over a tile, colour block, accent bar and outline badge). `.sitemark` in base.css; also on the public availability page and in PDFs. |
| `--banner` | The banner background: **white**, carrying the SaIL colour logo (the user's call, 2026-10-07; it was a magenta gradient with the white logo). The board below casts a shadow up onto it (`.app` box-shadow: a hairline round its rounded top plus a soft upward shadow) so the two read as separate layers. |
| sign-in logo | The boat logo (`assets/login-logo.png`) at the top of the sign-in box, 120px wide, centred - **the sign-in screen only** (the user's call, 2026-11-02). It keeps its white background, which blends into the white card: the face in the sail is white too and joins the outside, so a transparent cut-out would lose it. Under it **"SaIL Away"** (no hyphen), 26px bold in the logo's deep red `#760D45`, in **Frutiger** (same day) - only where Frutiger is installed (it isn't served), Arial elsewhere. The screen behind it is **plain white** (not the dimmed backdrop other pop-ups use) and the card has its own **tight, even shadow** - a 22px glow on every side at 28%, no drop (2026-11-03, tuned with the user; a grey outline was tried and rejected). `#login-backdrop`, `.loginlogo` / `.loginname` in base.css. |
| `--fg` / `--fg-2` / `--fg-3` | Text: primary / secondary (labels, muted cells) / tertiary (hints, counts, placeholders) |
| `--bg` | White: page, cards, fields, the open tab |
| `--group` | Grey fill: item rows, panels behind cards, plain buttons, read-only fields |
| `--row-hover` | Hover on grey fills |
| `--line` / `--line-strong` | Hairlines between rows / **field borders**, card borders, firm dividers |
| `--accent` | Blue: primary buttons, links, focus, inactive pop-up tabs, number badges |
| `--danger` / `--danger-bg` | **Deleting and destructive confirms only** (red, 2026-10-04) |
| `--warn` / `--warn-bg` | **Warnings only:** validation problems, "Unsaved changes", going back, typed date out of range |
| `--ok` | Success: "Open", "Paid", "Checked in" |
| `--edit` | Edit mode: the Edit button and the top bar's red sweep |
| `--step-quote/-invoice/-paid` | Invoice progress colours (status, not branding) |
| group `ink` / `tint` | Data-driven category colours (`PALETTE` in `core/data.js`), outside the palette on purpose |

### Type

System font stack (includes Segoe UI so Windows gets real 500/600 weights).

| Token | Size | Use |
|---|---|---|
| `--t-xs` | 11px | Pills, tiny meta (note status, small hints) |
| `--t-s` | 12px | Field labels, tags, counts, table headers, toolbar buttons |
| `--t-m` | 13px | Body default, buttons, rows, sub-rows |
| `--t-base` | 14px | Fields, pop-up body, tabs, dialog text |
| `--t-l` | 15px | Group names, question wording, large buttons |
| `--t-xl` | 17px | Pop-up / dialog / section titles, note titles |
| `--t-xxl` | 22px | Big empty-state headings, invoice totals |
| `--t-display` | 26px | Document and public-form titles |

Weights: 400 body, 500 buttons/row titles/labels, 600 headings and emphasis,
700 group names and badges.

### Shape and depth

| Token | Value | Use |
|---|---|---|
| `--r-s` | 6px | Small: pills on the pop-up header, note toolbar buttons, menu items |
| `--r` | 8px | **Fields**, group headers, problem boxes |
| `--r-l` | 12px | **Cards**: board cards (`.gcard`), editor cards, tables, lists |
| `--r-xl` | 16px | **Dialogs and pop-ups** |
| `--r-pill` | 999px | **Every button**, tags |
| `--shadow-card` / `--shadow-pop` | | Cards on grey / pop-ups and dialogs |
| `--shadow-raised` | | Cards on **white** with no outline - the shadow alone separates them (Forms' Questions editor) |
| `--focus` | 3px accent ring | **Fields** on focus (buttons, rows and links use the 2px accent outline from `:focus-visible`) |
| `--field-h` / `--field-h-compact` / `--btn-h` | 34 / 26 / 32px | Field and button heights |

### Contrast rules (the user's, 2026-10-04)

- **Nothing white on white.** A white card sits on grey (`--group`), a grey
  row sits on white. If two neighbours are the same colour, add a border
  (`--line-strong`) or change one of them. One exception, the user's call
  (2026-10-07): the Questions editor's white cards on its white panel,
  separated by `--shadow-raised` instead of an outline.
- Every editable box has a visible border. Every field in an editor has a
  label saying what it's for.
- The thing that matters most on a card is the boldest thing on it (group
  names outrank rows; question wording outranks its help text).

---

## 2. Components

Each lives in one place; views use it, they don't restyle it.

### Buttons - `.sbtn` (base.css)

Pill-shaped, always (2026-10-04). `.sbtn` grey · `.sbtn.primary` blue (the
main action - one per area) · `.sbtn.danger` red (confirm a delete) ·
`.sbtn.link` text-only blue · `.sbtn.link.danger` quiet delete (e.g. "Delete
note", "Delete quote") · sizes `.sm` (26px) and `.big` (44px) · `:disabled`
fades to 40%. The invoicer's step buttons are `.sbtn.iv-go`, in the step's
colour.

**Close** on a pop-up is always `.sbtn.primary`, top right.

Others, all pill-shaped: `.tbtn` quiet text buttons in bars (Expand all,
Log out, Today, Refresh); `.step` the arrow steppers; `.editbtn` the red
Edit / black Done.

### Icon buttons - `.ibtn` (base.css)

Round, 28px, for x, arrows and similar: `.ibtn` grey, `.ibtn.danger` red x
(delete a row, a line, a question, a response). Always give `title` and
`aria-label`.

### Fields - `.ed` (base.css)

**White with a firm border** (2026-10-04): `--line-strong` border, darker
on hover, accent border + `--focus` ring on focus, grey when disabled or
read-only. 34px; inside board rows `.glist .ed` is the 26px compact size.
`textarea.ed` grows; `select.ed` has the drawn chevron. The invoicer's
fields, the public form's fields, the note title and body, the search box
and the view picker all follow the same look (some restate it because
they're built without the class - keep them in step).

### Dropdown picker - `makePicker()` (core/picker.js)

The view picker, the banner's financial-year picker and its **Site**
picker (left of the year, only for people with more than one site -
the user's call, 2026-10-07) are one component
(2026-10-04): a white button with a chevron opening the app's own menu
(tick on the current choice, grey highlight, full keyboard support). Use it
for any "choose one" in the chrome; native `<select>` stays for fields
inside forms.

### Tick-list dropdown - `makeTickPicker()` (core/tickpick.js)

"Show these, hide those" for the rows of a calendar grid (the user's
design, 2026-10-09). Closed it's the dropdown picker's button ("All
rooms"); open, a menu of tickboxes with a bold **Select all** above a
line (tri-state when some are ticked). Each row can carry a site pill
(All). It stays open while ticking. **While anything is hidden the
button says how many are shown ("4 of 6 rooms") and turns the accent
colour with a dot** - a filter is never silent. Timetable and
Availability use it in place of the search box, in the week toolbar
**just left of Today** (`toolbar.rowFilter`; the user's call), for rooms; it's generic, meant for any future grid
in the timetable style. What's hidden is **that person's own view only**,
saved to their account (`core/prefs.js`, `user_prefs`) per site, shared
by the two views.

### Row order arrows - `paintGrid({ reorder })` (core/grid.js)

The other half of a person's own calendar view (the user's design,
2026-10-09): hovering a row's label (a room) shows two chevron buttons -
the boards' chevrons - **up in the label box's top-left corner, down in
its bottom-left** (the user's call). In All the site pill sits
bottom-left too, so while the arrows show it slides right of the down
arrow. Each click swaps the
room with the next one on show; the moved row glows the accent colour
briefly. First/last on show have their up/down greyed. Saved like the
tick-list - that person, per site, both views; the tick-list lists rooms
in the same order. Not on the public page.

### Banner (index.html, base.css `.banner`, `.bantab`)

White, the site's logo or wordmark on the left, the Site and year
dropdowns on the right **with no "Site" / "Financial year" labels** (the
user's call, 2026-10-09 - kept for screen readers only). While the pointer
is over it, a small white **tab** shows on its bottom edge, sitting on the
board like a filing tab; pressing it hides the banner, leaving a **12px
sliver in the site's colour** with a matching pull-tab hanging from it
(shown on hover) to bring it back. The board moves up into the space.
Remembered per person (`bannerHidden`).

### Rota blocks (views/schedule.js, css/views/schedule.css)

A session someone is allocated to is **filled** in its course group's
colour; leave is **hatched** - diagonal stripes of its kind's tint
(annual blue, WFH green, sick orange), **no border**, its words on a soft
white backing - the user's pick from a rig of six, 2026-10-09 ("B with no
border"; an outlined box before that, and filled before that). The key
shows both.

### Grouped lists - `.glist` (base.css)

The "data boards": Courses, Invoices, Forms, Staff, Admin (Staff and Admin have no
sub-items; one group per person, its header in the person's **site
colour** - like All's Courses, with the site pill in All - the user's
call 2026-10-09, replacing plain grey). Category header (tinted,
bold, in its ink) -> item rows (grey, 38px) -> sub-item rows. Full rules in
base.css and CLAUDE.md "Grouped lists all look the same". A new board uses
these classes and sets only its grid columns.

The group headers carry the calendars' booking shadow (`--shadow-booking`,
the user's call 2026-11-03). The card of rows under them stays flat: with
the shadow there too, it ringed an expanded item's white band of sub-items,
which the user didn't like.

**Sub-items** (the user's call, 2026-10-07, chosen in a test rig): an open
item's sub-items sit on a white band inside the item card (`.subs`, 22px
in, 12px above and below), in a white card with a `--line-strong` border
(`.subcard`). Their rows look like item rows - 38px, 500 weight, dividers
between - with the name 44px in, level with an item's title. Tried and
rejected: the old tree of 32px rows; a separate card on the page; grey,
lighter grey, group-tinted and coloured-edge cards; a lighter grey box
behind the card ("hated it"). An open item with nothing under it shows no
card (edit mode still shows the card, for its "Add" row).

**Row details** (the user's design, 2026-10-07, built up in a test rig): in
view mode an item's or sub-item's labels sit to the right of its title as
plain text cells - no pills - split by short centred ticks
(`--line-strong`, 14px), 20px either side, all in soft grey (`--fg-2`;
counts the board works out, `.rd.calc`, a shade lighter in `--fg-3` and
always first; a live form's "Open" in `--ok`). Columns line up down the
board: each is as wide as its widest value, per kind of row. The title is
locked on the left with a solid background in the row's own colour (min
320px; sub-items 297px so both end at the same point; Invoices: ref + a
260px title); when the details don't fit they scroll sideways under it -
every row in the board together - by trackpad, Shift + wheel or click and
drag (no scrollbars, the user's call). A soft shadow (18px, 9% fading out)
falls on whichever edge is hiding something: from the title's edge on the
left, from the row's end on the right. Edit mode keeps its field grid.
Markup and behaviour: `.lined` / `.rdata` / `.rd` in base.css,
`js/core/rowdetails.js` (call `lineUp(list)` after rendering a board).
On Invoices the progress bar is the first of the details; clicking its
steps downloads the PDF, so a row opens from its title or other cells.
Tried and rejected on the way: pills (grey for typed-in, white for
counts) with no columns, pills with fixed slots or fitted columns,
full-height dividers, tight spacing, mixed text colours, per-row
scrollbars and a scrollbar under each card.

**Every board opens fully collapsed** - groups and items (the user's call,
2026-10-07; Invoices and Forms used to open their groups). Track what's
*open* in a Set, never what's closed, so a fresh load or sign-in starts
shut; Expand all opens everything. Filtering still opens what matches. A
group or item created in edit mode opens itself, so it's there to fill in.

### Item pop-up - `openItem()` (views/sheet.js, css/views/sheet.css)

The standard pop-up for any item: a **white header** with pill, title,
subtitle and Close; filing tabs - **inactive tabs blue with white text,
the open tab white** running into the white panel, no outline; one panel
per tab. The panel and open tab read as one sheet lying on top of the
header, by shadow alone (the user's call, 2026-10-07; it was a deep grey
header): the panel casts a shadow **up** over the bottom of the tab row
(10px, 14% fading out, over the blue tabs too) and the open tab sits over
that, with its own matching shadow (`0 -1px 12px` at 20%) on the header
around its top and sides, clipped at its bottom edge. Don't build
another pop-up; add a tab. `canClose` guards unsaved edits.

### Cards

White, `--line-strong` border, `--r-l`, `--shadow-card`, on a grey panel.
Or, on a white panel: no border, `--shadow-raised` - the Forms Questions
editor (the user's call, 2026-10-07). An editor card with a grey header
band for its controls - the question cards in Forms are the model.

### Pills and tags

`.tag` (white pill on grey rows: counts, departments), `.iv-pill` (status:
quoted/invoiced/paid colours), `#backdrop .pill` (the group label on a
pop-up header). Number badges: blue circle, white bold number.

### Dialogs - `ask()` / `tell()` (core/dialog.js)

Never `confirm()`/`alert()`. Message, then Cancel (`.sbtn`) and the action
(`.sbtn.primary`, or `.sbtn.danger` when it deletes).

### Messages

Empty: `.empty`, centred, `--fg-2`. Problems: a `--warn-bg` box with the
title in `--warn` and a list. "Unsaved changes": `--warn` text.

### Spinner - `.spinner` (base.css)

For anything fetched live that takes a moment - Eventbrite events and
attendees (the user's call, 2026-10-07). A ring in `--line-strong` with an
`--accent` arc; 18px, or `.spinner.lg` 28px. Put it beside its message
with `.loading` ("Loading attendees from Eventbrite..."). The Tickets
calendar shows a large one centred over the grid on a light veil, so a
refresh still shows the month underneath. Slower, not stopped, with
reduced motion.

---

## 3. Exceptions (deliberate)

- **Timetable, Availability and Tickets calendars** keep their own small
  type (9-11.5px) - the event boxes' sizes feed a calculated threshold
  (CLAUDE.md "timetable rendering gotchas"). Change them only with that.
- **The Tickets calendar is always six weeks** (the user's call,
  2026-10-07: its size mustn't change between months): each month page
  fills the view, six week rows (never under 84px); the days around the
  month are dimmed.
- **A site with few rooms keeps normal-height rows** (Timetable,
  Availability): rows are sized as if there were at least six rooms, the
  last room is closed off with a `--line-strong` line, and the rest stays
  white - so the calendar looks finished, not cut off (the user's call,
  2026-10-07).
- **The calendars scroll as one strip** (the user's design, 2026-10-07;
  `js/core/strip.js`). Timetable and Availability are the whole year as
  day columns, sized so a week fills the view (never under 150px a day);
  Tickets is the year as twelve month pages side by side, each filling
  the view, a firm line where one meets the next (the user asked for
  sideways, after first having it scroll down through weeks). Two ways to
  move, use either: drag
  with a mouse (grab cursor), swipe or scroll - free, it stays where you
  let go (the user chose that over gliding to the nearest week); or the
  arrows / Today - glide to a whole Monday-to-Sunday week (Tickets: a
  whole month) and lock there. They open locked on the current week
  (Tickets: as before, the month of the next event). The label follows
  the view (Tickets: the month most on show).
  A drag never opens the booking or event under it. Timetable and
  Availability share their place. The public availability page does the
  same over a fixed window: 8 weeks back to a year ahead.
- **All three calendars run Monday to Sunday, weekends tinted** (the
  user's call, 2026-10-06 - Timetable and Availability used to stop at
  Friday, hiding weekend bookings). Weekends and today are tinted the same
  in every calendar, day header included: `--weekend` (`#F5F5F7`, the full `--group` grey) and
  `--today` (5% accent) in base.css, `.we` / `.today` from `core/grid.js`
  / `tickets.js`. Made more obvious at the user's ask (2026-11-03) - they
  were half of `--group` and 3% accent, too faint to notice.
  Every booking and event box - Timetable, Rota (allocations and hatched
  leave), Tickets, the public page - has the same soft shadow,
  `--shadow-booking`, so it lifts off those tints, which are as pale as the
  group tints (same day, the user's call; a coloured stripe down the left
  was tried and dropped).
  Timetable columns are 150px minimum (Tickets' are 130px) so the week fits.
- The public form page uses 40px fields and 15px text (touch-friendly).

---

## 4. Checklist for a UI change

1. Use existing components and tokens; if you need a new one, add it to
   base.css *and* this file *and* the style guide page.
2. Check contrast against the rules in 1.
3. Look at it - `/styleguide.html` and the real screens. For a broad
   change, capture before/after screenshots of every view (a Playwright
   script driving each screen, as done on 2026-10-04) and compare.
4. Record the user's decision here with the date.
