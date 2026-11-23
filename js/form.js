/* The public form page (form.html#<code>): draws one form from the "api"
   Edge Function's GET /forms/public/<code> and submits to POST on the same
   address (supabase/functions/api). No sign-in - plain fetch. The code is
   after # so it never reaches a server log; ?f=<code> works too.

   ?preview=1 is the board's Preview tab: the same page, but Submit is off
   and a note says so, and a closed form is still shown.

   Spam: a hidden "website" field people never see (bots fill it in), and
   the time since the page loaded - the server quietly drops submissions
   with the first filled in or the second under 2 seconds. */
import { esc } from "./core/util.js";
import { questionHTML, readAnswers, applyVisibility, missingAnswers, paras } from "./core/formrender.js";

const $ = id => document.getElementById(id);
const code = decodeURIComponent(location.hash.slice(1) || new URLSearchParams(location.search).get("f") || "");
const preview = new URLSearchParams(location.search).get("preview") === "1";
const url = `${window.SUPABASE_URL}/functions/v1/api/forms/public/${encodeURIComponent(code)}`;
const loadedAt = Date.now();
let form = null;

const card = html => { $("fcard").innerHTML = html; };
const notice = (title, text) => card(`<h1>${esc(title)}</h1><p class="fstatus">${esc(text)}</p>`);

async function load(){
  let res;
  try{ res = await fetch(url, { headers: { apikey: window.SUPABASE_KEY } }); }catch{ return notice("Can't load this form", "Please check your connection and try again."); }
  if(res.status === 404) return notice("Form not found", "This link isn't right, or the form has been removed.");
  if(!res.ok) return notice("Can't load this form", "Please try again in a moment.");
  form = await res.json();
  document.title = form.title || "Form";
  if(!form.open && !preview) return notice(form.title || "Form", "This form is closed and isn't taking responses.");
  draw();
}

function draw(){
  card(`${preview ? `<p class="fpreview">Preview - this is how the form looks. Answers aren't sent from here.${form.open ? "" : " The form is closed."}</p>` : ""}
    <h1>${esc(form.title)}</h1>
    ${form.intro ? `<div class="fintro">${paras(form.intro)}</div>` : ""}
    ${form.anonymous ? `<p class="fanon">This form is anonymous.</p>` : ""}
    <form id="fform" novalidate>
      ${form.questions.map(questionHTML).join("")}
      <div class="fhp" aria-hidden="true"><label>Website <input type="text" name="website" id="fhp" tabindex="-1" autocomplete="off"></label></div>
      <div class="fproblem" id="fproblem" role="alert" hidden></div>
      <div class="fsubmit"><button type="submit" class="sbtn primary" id="fsend"${preview ? " disabled" : ""}>${esc(form.submitLabel || "Submit")}</button>
        <span class="freqnote"><span class="freq">*</span> required</span></div>
    </form>`);
  const f = $("fform");
  applyVisibility(f, form.questions);
  f.addEventListener("input", () => applyVisibility(f, form.questions));
  f.addEventListener("change", () => applyVisibility(f, form.questions));
  f.addEventListener("submit", submit);
}

function problem(title, items = []){
  const p = $("fproblem");
  p.hidden = false;
  p.innerHTML = `<strong>${esc(title)}</strong>${items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
  p.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function submit(e){
  e.preventDefault();
  if(preview) return;
  const f = $("fform");
  const answers = readAnswers(f, form.questions);
  const missing = missingAnswers(form.questions, answers);
  if(missing.length) return problem("Please answer:", missing);
  const btn = $("fsend");
  btn.disabled = true;
  try{
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", apikey: window.SUPABASE_KEY },
      body: JSON.stringify({ answers, website: $("fhp").value, t: Date.now() - loadedAt }) });
    const out = await res.json().catch(() => ({}));
    if(res.status === 429) { btn.disabled = false; return problem("Too many tries - please wait a minute and send it again."); }
    if(!res.ok){ btn.disabled = false; return problem(out.error || "Couldn't send that. Please try again.", out.missing || out.invalid || []); }
    card(`<h1>${esc(form.title)}</h1><div class="fdone">${paras(form.thanks || "Thank you - your response has been sent.")}</div>`);
    window.scrollTo(0, 0);
  }catch{
    btn.disabled = false;
    problem("Couldn't send that - please check your connection and try again.");
  }
}

load();
