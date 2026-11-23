/* In-app replacements for confirm() and alert().

   The browser's own dialogs can't be relied on: some embedded browsers
   (the Claude desktop app's pane, for one) answer confirm() with "Cancel"
   without ever showing it, so every "Are you sure?" silently did nothing.
   These render in the page instead, above everything else, and return a
   promise:

     if(!await ask("Delete this?", { ok: "Delete", danger: true })) return;
     await tell("Couldn't save that.");

   Escape (or clicking outside) cancels; Enter confirms. While one is open,
   Escape doesn't reach the dialogs underneath it. */

let el = null, settle = null, lastFocus = null;

function build(){
  el = document.createElement("div");
  el.id = "dialog";
  el.className = "backdrop dialog-backdrop";
  el.innerHTML = `<div class="sheet dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-msg">
      <p id="dialog-msg"></p>
      <div class="actions">
        <button type="button" class="sbtn" id="dialog-cancel">Cancel</button>
        <button type="button" class="sbtn primary" id="dialog-ok">OK</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => {
    if(e.target.id === "dialog-ok") finish(true);
    else if(e.target.id === "dialog-cancel" || e.target === el) finish(false);
  });
  // Window, capture phase: runs before every other key handler (the pop-up
  // and sheet listen on document), so while a dialog is open they never see
  // the key - and a key that opens one isn't then read by it as well.
  window.addEventListener("keydown", e => {
    if(!settle) return;
    if(e.key === "Escape"){ e.stopImmediatePropagation(); e.preventDefault(); finish(false); }
    else if(e.key === "Enter" && e.target.id !== "dialog-cancel"){ e.stopImmediatePropagation(); e.preventDefault(); finish(true); }
    else if(e.key === "Tab"){   // keep focus inside
      const b = [...el.querySelectorAll("button:not([hidden])")];
      const i = b.indexOf(document.activeElement);
      e.preventDefault();
      b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus();
    }
  }, true);
}

function finish(result){
  if(!settle) return;
  const s = settle;
  settle = null;
  el.classList.remove("open");
  lastFocus?.focus?.();
  s(result);
}

function show(message, { ok = "OK", cancel = "Cancel", danger = false, alert = false } = {}){
  if(!el) build();
  if(settle) finish(false);   // one at a time
  lastFocus = document.activeElement;
  el.querySelector("#dialog-msg").textContent = message;
  const okBtn = el.querySelector("#dialog-ok"), cancelBtn = el.querySelector("#dialog-cancel");
  okBtn.textContent = ok;
  okBtn.classList.toggle("danger", danger);
  cancelBtn.textContent = cancel;
  cancelBtn.hidden = alert;
  el.classList.add("open");
  (alert || !danger ? okBtn : cancelBtn).focus();
  return new Promise(resolve => { settle = resolve; });
}

// confirm(): resolves true for OK, false for Cancel/Escape/outside click.
export const ask = (message, opts) => show(message, opts);
// alert(): resolves when dismissed.
export const tell = message => show(message, { alert: true }).then(() => {});
