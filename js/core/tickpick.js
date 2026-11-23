/* The tick-list dropdown - "show these, hide those" for the rows of a
   calendar grid (the user's design, 2026-10-09: Timetable and Availability
   list their rooms; the same grid will show other things later, so this
   names nothing in particular). It looks like the dropdown picker
   (core/picker.js) closed, and opens a menu of tickboxes with "Select all"
   at the top. While anything is hidden the button says so ("4 of 6 rooms")
   and turns the accent colour.

   Markup (see index.html #rowpick):
     <div class="viewpick tickpick" id="...">
       <button class="viewbtn" aria-haspopup="true" aria-expanded="false" aria-controls="MENU">
         <span class="viewlabel"></span><svg class="viewchev">...</svg></button>
       <div class="viewmenu tickmenu" id="MENU" hidden></div>
     </div>

     const p = makeTickPicker(rootEl, { noun: "rooms", onChange: hidden => ... });
     p.set([{ value, label, tag?, colour? }, ...], hiddenValues, noun?);   // (re)build

   `hidden` is a Set of values. Hidden values with no item on show are kept
   (handed back in onChange), so a row missing for a while isn't forgotten.
   Real checkboxes, so Tab/Space work as anywhere; Escape or clicking
   outside closes it. It stays open while ticking. */
import { esc } from "./util.js";

export function makeTickPicker(root, { noun, onChange }){
  // noun can change with each set() - one dropdown serves several views.
  const btn = root.querySelector(".viewbtn");
  const menu = root.querySelector(".tickmenu");
  const label = root.querySelector(".viewlabel");
  let items = [], hidden = new Set();

  const shownCount = () => items.filter(it => !hidden.has(it.value)).length;
  function paintButton(){
    const n = shownCount(), all = n === items.length;
    label.textContent = all ? `All ${noun}` : n ? `${n} of ${items.length} ${noun}` : `No ${noun}`;
    btn.classList.toggle("filtered", !all);
    btn.title = all ? "" : `Some ${noun} are hidden from your view`;
  }
  function paintTicks(){
    const n = shownCount(), all = menu.querySelector("[data-all]");
    if(all){ all.checked = n === items.length; all.indeterminate = n > 0 && n < items.length; }
    menu.querySelectorAll("[data-i]").forEach(cb => { cb.checked = !hidden.has(items[+cb.dataset.i].value); });
  }

  function open(){
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    (menu.querySelector("input:checked") || menu.querySelector("input"))?.focus();
  }
  function close(refocus){
    if(menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if(refocus) btn.focus();
  }

  btn.addEventListener("click", () => { menu.hidden ? open() : close(true); });
  btn.addEventListener("keydown", e => {
    if(e.key === "ArrowDown"){ e.preventDefault(); open(); }
  });
  menu.addEventListener("change", e => {
    const cb = e.target;
    if(cb.hasAttribute("data-all")){
      items.forEach(it => cb.checked ? hidden.delete(it.value) : hidden.add(it.value));
    }else if(cb.dataset.i !== undefined){
      const v = items[+cb.dataset.i].value;
      cb.checked ? hidden.delete(v) : hidden.add(v);
    }
    paintTicks();
    paintButton();
    onChange(new Set(hidden));
  });
  menu.addEventListener("keydown", e => {
    // stopPropagation: the document-level Escape handler closes the detail
    // sheet, which isn't what Escape means while this menu is open.
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(true); }
    else if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      const boxes = [...menu.querySelectorAll("input")], i = boxes.indexOf(document.activeElement);
      e.preventDefault();
      boxes[Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), boxes.length - 1)]?.focus();
    }
  });
  document.addEventListener("pointerdown", e => { if(!root.contains(e.target)) close(false); });
  root.addEventListener("focusout", e => { if(e.relatedTarget && !root.contains(e.relatedTarget)) close(false); });

  return {
    set(list, hiddenValues, newNoun){
      if(newNoun) noun = newNoun;
      items = list;
      hidden = new Set(hiddenValues || []);
      menu.innerHTML = !items.length ? `<div class="tickempty">No ${esc(noun)}</div>` :
        `<label class="tickrow tickall"><input type="checkbox" data-all> Select all</label>` +
        items.map((it, i) => `<label class="tickrow"><input type="checkbox" data-i="${i}">` +
          `<span class="ticklabel">${esc(it.label)}</span>` +
          (it.tag ? `<span class="sitetag" style="--site:${esc(it.colour || "")}">${esc(it.tag)}</span>` : "") +
          `</label>`).join("");
      paintTicks();
      paintButton();
    },
    get hidden(){ return new Set(hidden); },
  };
}
