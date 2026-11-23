/* Row details on the grouped boards (.glist - Courses, Forms, Invoices):
   the labels to the right of an item's or sub-item's title (the user's
   design, 2026-10-07, picked in a test rig - docs/DESIGN.md "Row details").

   Markup, in view mode: the row gets class "lined"; its title is .name (or
   .ref + .ttl on Invoices), then one .rdata holding a .rd cell per label
   (counts the board works out first, as .rd.calc). .rdata carries
   data-kind="course" etc.: rows of the same kind share column widths.

   lineUp(list), called after every render of a board:
   - sizes each column to its widest cell, per kind of row, so the cells
     line up down the board;
   - lets the details scroll sideways under the locked title when they
     don't fit - every row in the board moves together (trackpad, shift +
     wheel, or click and drag with a mouse; a drag doesn't count as a click);
   - casts a soft shadow on whichever edge is hiding something (.sh-left
     from the title's edge, .sh-right from the row's end).
   A board drawn while hidden is measured when it's first shown (a
   ResizeObserver notices it getting a size). */
import { dragScroll } from "./dragscroll.js";

const ro = new ResizeObserver(entries => entries.forEach(({ target: list }) => {
  if(!list.offsetWidth) return;
  if(list._dirty) lineUp(list); else edges(list);
}));
const wired = new WeakSet();

export function lineUp(list){
  if(!wired.has(list)){ wired.add(list); wire(list); ro.observe(list); }
  if(!list.offsetWidth){ list._dirty = true; return; }   // hidden: measure on show
  list._dirty = false;

  const kinds = {};
  list.querySelectorAll(".rdata").forEach(r => (kinds[r.dataset.kind] ||= []).push(r));
  for(const rows of Object.values(kinds)){
    // A blank cell (no lead, no responses yet) keeps its column but drops its tick.
    rows.forEach(r => { for(const c of r.children){ c.style.width = ""; c.classList.toggle("blank", !c.children.length && !c.textContent.trim()); } });
    const w = [];
    rows.forEach(r => [...r.children].forEach((c, i) => { w[i] = Math.max(w[i] || 0, Math.ceil(c.getBoundingClientRect().width)); }));
    rows.forEach(r => [...r.children].forEach((c, i) => { c.style.width = w[i] + "px"; }));
  }
  // A re-render (expanding a row, an edit) keeps the board where it was scrolled.
  list.querySelectorAll(".rdata").forEach(r => { r.scrollLeft = list._sx || 0; });
  edges(list);
}

function edges(list){
  list.querySelectorAll(".rdata").forEach(r => {
    const row = r.parentElement, room = r.scrollWidth - r.clientWidth, over = room > 1;
    r.classList.toggle("can-drag", over);
    row.classList.toggle("sh-left", over && r.scrollLeft > 0);
    row.classList.toggle("sh-right", over && r.scrollLeft < room - 1);
    row.style.setProperty("--tl", (r.getBoundingClientRect().left - row.getBoundingClientRect().left) + "px");
  });
}

function wire(list){
  let syncing = false;

  // Every row's details scroll together, so the columns stay lined up.
  list.addEventListener("scroll", e => {
    const src = e.target;
    if(syncing || !src.classList?.contains("rdata")) return;
    syncing = true;
    list._sx = src.scrollLeft;
    list.querySelectorAll(".rdata").forEach(r => { if(r !== src) r.scrollLeft = src.scrollLeft; });
    syncing = false;
    edges(list);
  }, true);

  // Mouse: click and drag the details sideways (core/dragscroll.js).
  dragScroll(list, { axis: "x", scroller: e => e.target.closest(".rdata.can-drag") });
}
