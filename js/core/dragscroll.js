/* Click-and-drag scrolling with a mouse (trackpads and touch scroll
   natively). Used by the boards' row details (core/rowdetails.js) and the
   calendars (core/strip.js).

   dragScroll(container, { axis, scroller, onStart })
     axis     - "x" or "y"
     scroller - (pointerdown event) => the element to scroll, or null to
                ignore this press (default: the container itself)
     onStart  - called once a press has moved far enough to be a drag
   A press that moves less than 4px is a click as usual. One that drags
   doesn't count as a click, so letting go never opens what's under it.
   Standalone (no app state), so the public availability page can use it. */

export function dragScroll(container, { axis = "x", scroller = () => container, onStart } = {}){
  let drag = null;
  const at = e => axis === "x" ? e.clientX : e.clientY;

  container.addEventListener("pointerdown", e => {
    if(e.pointerType !== "mouse" || e.button !== 0) return;
    if(e.target.closest("input, select, textarea, [contenteditable]")) return;
    const el = scroller(e);
    if(!el) return;
    drag = { el, from: at(e), start: axis === "x" ? el.scrollLeft : el.scrollTop, moved: false };
  });
  window.addEventListener("pointermove", e => {
    if(!drag) return;
    const d = at(e) - drag.from;
    if(!drag.moved && Math.abs(d) < 4) return;
    if(!drag.moved){ drag.moved = true; document.body.classList.add("dragging"); onStart?.(); }
    if(axis === "x") drag.el.scrollLeft = drag.start - d; else drag.el.scrollTop = drag.start - d;
  });
  window.addEventListener("pointerup", () => {
    if(!drag) return;
    if(drag.moved){
      document.body.classList.remove("dragging");
      // The click that ends a drag mustn't open what's under it. Only that
      // one: if no click follows (released elsewhere), stop waiting for it.
      const eat = ev => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", eat, { capture: true }), 100);
    }
    drag = null;
  });
}
