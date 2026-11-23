/* Each person's own view settings, kept in their `user_prefs` row
   (pb_migrations/1735000025) so they follow them to any computer. They only
   ever change that person's view - never the board, never anyone else's.

     await loadPrefs()        after sign-in (shell.js boot)
     pref(key, fallback)      read one
     setPref(key, value)      change one; saved shortly after (one request
                              for a burst of changes, e.g. ticking several)
     clearPrefs()             sign-out

   A failed save is logged, not shown: a lost setting just means the view
   comes back as it was, which isn't worth interrupting anyone over. */
import { pb } from "./pb.js";

let data = {}, rowId = null, timer = null, loadedFor = null;

export async function loadPrefs(){
  const me = pb.authStore.record?.id;
  data = {}; rowId = null; loadedFor = me;
  if(!me) return;
  try{
    const row = await pb.collection("user_prefs").getFirstListItem(pb.filter("user = {:u}", { u: me }), { requestKey: null });
    rowId = row.id;
    data = row.data && typeof row.data === "object" ? row.data : {};
  }catch(err){
    if(err?.status !== 404) console.error("Could not load your view settings", err);
  }
}

export const pref = (key, fallback) => key in data ? data[key] : fallback;

export function setPref(key, value){
  if(value === undefined || (Array.isArray(value) && !value.length)) delete data[key];
  else data[key] = value;
  clearTimeout(timer);
  timer = setTimeout(save, 400);
}

async function save(){
  const me = pb.authStore.record?.id;
  if(!me || me !== loadedFor) return;   // signed out (or someone else) since
  try{
    if(rowId) await pb.collection("user_prefs").update(rowId, { data }, { requestKey: null });
    else rowId = (await pb.collection("user_prefs").create({ user: me, data }, { requestKey: null })).id;
  }catch(err){
    console.error("Could not save your view settings", err);
  }
}

export function clearPrefs(){
  clearTimeout(timer);
  data = {}; rowId = null; loadedFor = null;
}
