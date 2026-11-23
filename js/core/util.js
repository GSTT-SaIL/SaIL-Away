/* Shared helpers with no app state: dates, escaping, sanitising, debouncing,
   and an icon or two. Safe to import from anywhere, including the public
   availability page (nothing here talks to PocketBase). */

export const DOW = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
export const MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export const TODAY = new Date();

export const parseISO = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
export const toISO = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
export const addDays = (d,n) => { const c = new Date(d); c.setDate(c.getDate()+n); return c; };
export const mins = t => { const [h,m] = t.split(":").map(Number); return h*60+m; };
export function mondayOf(d){ const c = new Date(d.getFullYear(),d.getMonth(),d.getDate()); c.setDate(c.getDate()-((c.getDay()+6)%7)); return c; }
export const shortDate = iso => { const d = parseISO(iso); return DOW[(d.getDay()+6)%7].slice(0,3)+" "+d.getDate()+" "+MON[d.getMonth()].slice(0,3); };
export const longDate  = d   => DOW[(d.getDay()+6)%7]+" "+d.getDate()+" "+MON[d.getMonth()]+" "+d.getFullYear();

export const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

export const CHEV = '<svg class="chev" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Allowlist sanitizer, run before display AND before every save. The real
// security boundary is the matching server-side hook
// (pocketbase/pb_hooks/session_notes.pb.js) - this is a client-side pass
// for well-behaved browsers so pasted content doesn't carry along scripts,
// styles, images or stray attributes into the editor in the first place.
export function sanitizeHtml(html){
  const allowed = new Set(["B","STRONG","I","EM","U","UL","OL","LI","BR","P","A","SPAN","DIV"]);
  const root = document.createElement("div");
  root.innerHTML = html || "";
  (function clean(node){
    [...node.childNodes].forEach(child=>{
      if(child.nodeType === Node.ELEMENT_NODE){
        if(!allowed.has(child.tagName)){
          while(child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          return;
        }
        [...child.attributes].forEach(attr=>{
          if(child.tagName === "A" && attr.name === "href"){
            if(!/^(https?:|mailto:)/i.test(attr.value)) child.removeAttribute("href");
            else { child.setAttribute("target","_blank"); child.setAttribute("rel","noopener noreferrer"); }
          } else child.removeAttribute(attr.name);
        });
        clean(child);
      } else if(child.nodeType !== Node.TEXT_NODE){
        node.removeChild(child);
      }
    });
  })(root);
  return root.innerHTML;
}

// Typing updates the in-memory copy (and re-renders) on every keystroke so
// it stays responsive, but the write to PocketBase is debounced per key so
// it doesn't fire on every keystroke.
const saveTimers = new Map();
export function debounceSave(key, fn, delay=500){
  clearTimeout(saveTimers.get(key));
  saveTimers.set(key, setTimeout(fn, delay));
}
