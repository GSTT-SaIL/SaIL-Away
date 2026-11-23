/* A calendar drawn as one long strip that scrolls - Timetable and
   Availability sideways through the days, Tickets up and down through the
   weeks (the user's design, 2026-10-07). Two ways to move, use either:
   - drag with a mouse, swipe a trackpad or scroll: free, it stays exactly
     where you let go;
   - the arrows / Today: glide to a whole week (or a month's first week)
     and lock there - the caller decides where, this just goes.

   makeStrip({ wrap, axis, unit, onMove })
     wrap   - the scrolling element
     axis   - "x" (columns are days) or "y" (rows are weeks)
     unit() - px per step along the axis (a day column's width, a week row's
              height), measured from the drawn grid
     onMove(index, locked) - after any move; index is the step at the start
              of the view (the locked one while gliding there)
   strip.go(i, { smooth, lock }) scrolls to step i. While the strip is
   hidden it waits, and goes when it's shown (strip.flush() from a view's
   show() does it at once). A locked strip stays lined up
   when the window is resized. Standalone (no app state). */
import { dragScroll } from "./dragscroll.js";

export function makeStrip({ wrap, axis, unit, onMove }){
  let locked = null, pending = null, u = 0;
  const shown = () => (axis === "x" ? wrap.clientWidth : wrap.clientHeight) > 0;
  const pos = () => axis === "x" ? wrap.scrollLeft : wrap.scrollTop;
  // The step size, measured once and kept - measuring on every scroll
  // event forces a layout each time. Re-measured on resize and on go().
  const step = () => u ||= unit();
  const at = () => { const s = step(); return s ? Math.round(pos() / s) : 0; };
  const moved = () => onMove?.(strip.index, locked !== null);
  const scroll = (i, smooth) => wrap.scrollTo({ [axis === "x" ? "left" : "top"]: i * step(), behavior: smooth ? "smooth" : "instant" });

  const strip = {
    get index(){ return locked ?? at(); },
    get locked(){ return locked !== null; },
    // Exactly where the view starts, in steps (2.4 = 40% into step 2).
    get offset(){ const s = step(); return locked ?? (s ? pos() / s : 0); },
    go(i, { smooth = true, lock = true } = {}){
      if(!shown()){ pending = { i, lock }; return; }
      pending = null; u = 0;
      locked = lock ? i : null;
      scroll(i, smooth);
      moved();
    },
    // Call when the strip's view comes on show: a go() that was waiting
    // happens now, rather than on the ResizeObserver a frame later (the
    // label would be blank until then).
    flush(){ if(pending && shown()){ const p = pending; strip.go(p.i, { smooth: false, lock: p.lock }); } },
  };

  // Anything the person does themselves frees the strip.
  const free = () => { locked = null; };
  wrap.addEventListener("wheel", free, { passive: true });
  wrap.addEventListener("touchstart", free, { passive: true });
  dragScroll(wrap, { axis, onStart: free });
  wrap.addEventListener("scroll", moved, { passive: true });

  new ResizeObserver(() => {
    u = 0;
    if(!shown()) return;
    if(pending){ const p = pending; strip.go(p.i, { smooth: false, lock: p.lock }); }
    else if(locked !== null) scroll(locked, false);   // stay lined up at the new size
  }).observe(wrap);

  return strip;
}
