/* Draws a form from its definition and reads the answers back - for the
   public form page (form.html, js/form.js), which the board's Preview tab
   shows in a frame, so the preview is exactly what respondents see.

   Pure: no app state, no PocketBase - like core/grid.js, which is what lets
   the sign-in-free page use it.

   A question (forms.questions, edited in views/forms.js):
     { id, type, label, help, required, options, display, showIf }
     type     text | long | choice | number | date | email | yesno | info
              (info = a heading and text between questions, not a question)
     options  choice only: the answers to pick from
     display  choice only: "dropdown" | "list" (one per line) | "scale"
              (in a row, e.g. 1-10)
     showIf   { q, value } - only asked when earlier question q's answer is
              value ("Role = Other -> Please specify")
   The server checks the same rules again (pb_hooks/forms.pb.js). */
import { esc } from "./util.js";

export const TYPES = {
  text: "Short text", long: "Long text", choice: "Choice", number: "Number",
  date: "Date", email: "Email", yesno: "Tick box", info: "Heading and text",
};
export const DISPLAYS = { dropdown: "Dropdown", list: "List", scale: "Scale (in a row)" };

// Plain text with line breaks -> paragraphs (intro, help, thank-you).
export const paras = text => String(text || "").split(/\n+/).map(p => p.trim()).filter(Boolean)
  .map(p => `<p>${esc(p)}</p>`).join("");

export const isShown = (q, answers) =>
  !q.showIf || !q.showIf.q || String(answers[q.showIf.q] ?? "") === String(q.showIf.value);

function control(q){
  const id = "fq-" + esc(q.id), req = q.required ? " required" : "";
  const attrs = `id="${id}" name="${esc(q.id)}" data-q="${esc(q.id)}"${req}`;
  switch(q.type){
    case "long":   return `<textarea ${attrs} rows="4" maxlength="5000"></textarea>`;
    case "number": return `<input type="number" step="any" ${attrs}>`;
    case "date":   return `<input type="date" ${attrs}>`;
    case "email":  return `<input type="email" ${attrs} maxlength="254" autocomplete="email">`;
    case "yesno":  return `<label class="ftick"><input type="checkbox" ${attrs}><span>${esc(q.label)}${q.required ? ' <span class="freq">*</span>' : ""}</span></label>`;
    case "choice": {
      const opts = q.options || [];
      if(q.display === "list" || q.display === "scale")
        return `<div class="fopts ${q.display}" role="radiogroup" aria-labelledby="${id}-l">${opts.map((o, i) =>
          `<label class="fopt"><input type="radio" name="${esc(q.id)}" value="${esc(o)}" data-q="${esc(q.id)}"${req && i === 0 ? " required" : ""}><span>${esc(o)}</span></label>`).join("")}</div>`;
      return `<select ${attrs}><option value="">Choose...</option>${opts.map(o => `<option>${esc(o)}</option>`).join("")}</select>`;
    }
    default:       return `<input type="text" ${attrs} maxlength="500">`;
  }
}

export function questionHTML(q){
  if(q.type === "info") return `<div class="fblock finfo" data-qwrap="${esc(q.id)}"><h3>${esc(q.label)}</h3>${paras(q.help)}</div>`;
  const label = q.type === "yesno" ? "" : `<label class="flabel" id="fq-${esc(q.id)}-l" for="fq-${esc(q.id)}">${esc(q.label)}${q.required ? ' <span class="freq">*</span>' : ""}</label>`;
  return `<div class="fblock" data-qwrap="${esc(q.id)}">${label}${q.help ? `<div class="fhelp">${paras(q.help)}</div>` : ""}${control(q)}</div>`;
}

// The answers as they stand, keyed by question id (only questions shown).
export function readAnswers(root, questions){
  const answers = {};
  questions.forEach(q => {
    if(q.type === "info" || !isShown(q, answers)) return;
    if(q.type === "yesno"){ answers[q.id] = !!root.querySelector(`[data-q="${q.id}"]`)?.checked; return; }
    if(q.type === "choice" && (q.display === "list" || q.display === "scale")){
      answers[q.id] = root.querySelector(`input[data-q="${q.id}"]:checked`)?.value || ""; return;
    }
    answers[q.id] = (root.querySelector(`[data-q="${q.id}"]`)?.value || "").trim();
  });
  return answers;
}

// Show or hide each question by its "show if" rule, from the answers so far.
export function applyVisibility(root, questions){
  const answers = readAnswers(root, questions);
  questions.forEach(q => {
    const w = root.querySelector(`[data-qwrap="${q.id}"]`);
    if(!w) return;
    const shown = isShown(q, answers);
    w.hidden = !shown;
    // A hidden question mustn't block the browser's required check.
    w.querySelectorAll("[data-q]").forEach(i => { i.disabled = !shown; });
  });
}

// Required questions (that are shown) left blank - their wording.
export function missingAnswers(questions, answers){
  return questions.filter(q => q.type !== "info" && q.required && isShown(q, answers))
    .filter(q => { const v = answers[q.id]; return v === undefined || v === "" || v === false; })
    .map(q => q.label);
}
