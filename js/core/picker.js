/* The dropdown picker - one component for every "choose one of these" in
   the chrome: the view picker in the top bar and the financial year in the
   banner (the user's call, 2026-10-04: they should look the same). A native
   <select> can't be used: its open list is drawn by the browser and can't
   be styled.

   Markup (see index.html):
     <div class="viewpick" id="...">
       <button class="viewbtn" aria-haspopup="listbox" aria-expanded="false" aria-controls="MENU">
         <span class="viewlabel"></span><svg class="viewchev">...</svg></button>
       <ul class="viewmenu" id="MENU" role="listbox" tabindex="-1" hidden></ul>
     </div>

   Follows the WAI-ARIA "select-only combobox"/listbox pattern: focus stays
   on the list while it's open, aria-activedescendant tracks the highlighted
   option. Keys: Down/Up open it from the button; in the list Up/Down/Home/
   End move, Enter/Space pick, Escape/Tab close. Click outside, or focus
   leaving it, closes it.

     const p = makePicker(rootEl, item => ...);   // called when the choice changes
     p.set([{ value, label }, ...], selectedValue);  // (re)build the options */
import { esc } from "./util.js";

export function makePicker(root, onChoose){
  const btn = root.querySelector(".viewbtn");
  const menu = root.querySelector(".viewmenu");
  const label = root.querySelector(".viewlabel");
  let items = [], selected = -1;
  const options = () => [...menu.querySelectorAll("[role=option]")];

  function highlight(i){
    const opts = options();
    if(!opts[i]) return;
    opts.forEach((o, j) => o.classList.toggle("active", j === i));
    menu.setAttribute("aria-activedescendant", opts[i].id);
    opts[i].scrollIntoView({ block: "nearest" });
  }
  function open(){
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    highlight(Math.max(selected, 0));
    menu.focus();
  }
  function close(refocus){
    if(menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if(refocus) btn.focus();
  }
  function mark(i){
    selected = i;
    options().forEach((o, j) => o.setAttribute("aria-selected", String(j === i)));
    label.textContent = items[i] ? items[i].label : "";
  }
  function choose(i){
    if(!items[i]) return;
    const changed = i !== selected;
    mark(i);
    close(true);
    if(changed) onChoose(items[i]);
  }

  btn.addEventListener("click", () => { menu.hidden ? open() : close(true); });
  btn.addEventListener("keydown", e => {
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); open(); }
  });
  menu.addEventListener("keydown", e => {
    const cur = options().findIndex(o => o.classList.contains("active"));
    const last = items.length - 1;
    if(e.key === "ArrowDown"){ e.preventDefault(); highlight(Math.min(cur + 1, last)); }
    else if(e.key === "ArrowUp"){ e.preventDefault(); highlight(Math.max(cur - 1, 0)); }
    else if(e.key === "Home"){ e.preventDefault(); highlight(0); }
    else if(e.key === "End"){ e.preventDefault(); highlight(last); }
    else if(e.key === "Enter" || e.key === " "){ e.preventDefault(); choose(cur); }
    // stopPropagation: the document-level Escape handler closes the detail
    // sheet, which isn't what Escape means while this menu is open.
    else if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(true); }
    else if(e.key === "Tab"){ close(false); }
  });
  menu.addEventListener("mousemove", e => {
    const o = e.target.closest("[role=option]");
    if(o && !o.classList.contains("active")) highlight(options().indexOf(o));
  });
  menu.addEventListener("click", e => {
    const o = e.target.closest("[role=option]");
    if(o) choose(options().indexOf(o));
  });
  document.addEventListener("pointerdown", e => { if(!root.contains(e.target)) close(false); });
  menu.addEventListener("focusout", e => { if(!root.contains(e.relatedTarget)) close(false); });

  return {
    set(list, value){
      items = list;
      menu.innerHTML = items.map((it, j) =>
        `<li role="option" id="${menu.id}-opt-${j}" aria-selected="false">${esc(it.label)}</li>`).join("");
      mark(Math.max(items.findIndex(it => it.value === value), items.length ? 0 : -1));
    },
    get value(){ return items[selected]?.value; },
  };
}
