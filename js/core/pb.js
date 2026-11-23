/* The data client: Supabase underneath, the PocketBase-shaped `pb` object
   on top. The board was written against PocketBase's SDK; rather than
   rewrite every view, this gives them the same small surface they used:

     pb.authStore            .record .isValid .remember .clear() .onChange()
     pb.collection(name)     .getFullList  .getList  .getFirstListItem
                             .create  .update  .delete
                             .authWithPassword  .authRefresh   ("users" only)
     pb.filter(expr, params) PocketBase filter text with {:name} values
     pb.send(path, opts)     the server routes (/api/...), now an Edge Function
     pb.files.getURL(...)    app card images (Supabase Storage)

   Filters are PocketBase's syntax - `a = "x" && (b >= "y" || c != "")` -
   parsed here and turned into PostgREST filters. Only what the board uses
   is supported: = != > >= < <= ~ ?=, && || and brackets, and a relation's
   field ("session.date", top level only). Anything else throws, loudly.

   Errors carry PocketBase's shape: .status (400 bad data / a rule in the
   database said no, 401 signed out, 403 not allowed, 404 not found) and
   .message, the reason in plain words. */
import { createClient } from "../vendor/supabase.esm.js";

const URL_ = window.SUPABASE_URL;
const KEY = window.SUPABASE_KEY;

/* Where the sign-in is kept, decided by "Keep me signed in on this
   computer" on the sign-in form:
   - ticked:   localStorage - survives closing the browser. Supabase
               refreshes the token as it's used, so regular use never signs
               anyone out.
   - unticked: sessionStorage - survives reloads, gone when the browser
               closes. The default, since these are often shared PCs.
   Log out clears both. */
const AUTH_KEY = "sail_away_auth";
const RECORD_KEY = "sail_away_record";
let remember = false;
try{ remember = !!localStorage.getItem(AUTH_KEY); }catch{}
const store = () => remember ? localStorage : sessionStorage;
const storage = {
  getItem: k => { try{ return localStorage.getItem(k) ?? sessionStorage.getItem(k); }catch{ return null; } },
  setItem: (k, v) => { try{ localStorage.removeItem(k); sessionStorage.removeItem(k); store().setItem(k, v); }catch{} },
  removeItem: k => { try{ localStorage.removeItem(k); sessionStorage.removeItem(k); }catch{} },
};

export const sb = createClient(URL_, KEY, {
  auth: { storage, storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/* ------------------------------------------------------------ errors */

export class ClientError extends Error {
  constructor(status, message, data = {}){
    super(message || "Something went wrong.");
    this.status = status;
    this.data = data;
    this.response = { message: this.message, ...data };
  }
}

// A PostgREST / Postgres error -> the status PocketBase would have given.
function fail(error, status){
  if(error instanceof ClientError) throw error;
  const code = error?.code || "";
  let s = status || 400;
  if(code === "42501") s = 403;                                  // a policy said no
  else if(code === "PGRST301" || code === "PGRST303" || /JWT/i.test(error?.message || "")) s = 401;
  else if(code === "PGRST116") s = 404;                          // no row
  throw new ClientError(s, error?.message || String(error), { code });
}

/* ------------------------------------------------------------ sign-in */

let record = null;
try{ record = JSON.parse(storage.getItem(RECORD_KEY) || "null"); }catch{ record = null; }
let session = null;
try{ session = (await sb.auth.getSession()).data.session; }catch{ session = null; }
const listeners = new Set();
const changed = () => listeners.forEach(fn => { try{ fn(authStore.token, record); }catch(e){ console.error(e); } });

sb.auth.onAuthStateChange((_event, s) => { session = s; });

function setRecord(r){
  record = r;
  if(r) storage.setItem(RECORD_KEY, JSON.stringify(r)); else storage.removeItem(RECORD_KEY);
  changed();
}

// The signed-in person's account as the board uses it (was the "users"
// record): id, email, name, role, sites, home_site.
async function loadProfile(){
  const { data, error } = await sb.from("profiles").select("id,email,name,role,sites,home_site").maybeSingle();
  if(error) fail(error);
  if(!data) throw new ClientError(401, "This account has no profile.");
  return data;
}

export const authStore = {
  get record(){ return record; },
  get token(){ return session?.access_token || ""; },
  get isValid(){ return !!(session && record && session.expires_at * 1000 > Date.now() - 5 * 60_000); },
  get remember(){ return remember; },
  set remember(v){ remember = !!v; },
  isSuperuser: false,
  isAdmin: false,
  isAuthRecord: true,
  clear(){
    session = null;
    setRecord(null);
    sb.auth.signOut({ scope: "local" }).catch(() => {});
    storage.removeItem(AUTH_KEY);
  },
  onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },
};

/* ------------------------------------------------------------ filters */

// pb.filter('a = {:x}', { x: 'it"s' }) -> 'a = "it\"s"' - values quoted and
// escaped, exactly as PocketBase did it, so nothing typed can change the filter.
function filter(expr, params = {}){
  return expr.replace(/\{:(\w+)\}/g, (_, k) => {
    const v = params[k];
    if(v === null || v === undefined) return "null";
    if(typeof v === "number" || typeof v === "boolean") return String(v);
    return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  });
}

function tokenize(s){
  const out = [];
  let i = 0;
  while(i < s.length){
    const c = s[i];
    if(/\s/.test(c)){ i++; continue; }
    if(c === "(" || c === ")"){ out.push({ t: c }); i++; continue; }
    const two = s.slice(i, i + 2);
    if(two === "&&" || two === "||"){ out.push({ t: two }); i += 2; continue; }
    if([">=", "<=", "!=", "?="].includes(two)){ out.push({ t: "op", v: two }); i += 2; continue; }
    if("=<>~".includes(c)){ out.push({ t: "op", v: c }); i++; continue; }
    if(c === '"' || c === "'"){
      let j = i + 1, v = "";
      while(j < s.length && s[j] !== c){
        if(s[j] === "\\" && j + 1 < s.length){ v += s[j + 1]; j += 2; } else { v += s[j]; j++; }
      }
      if(j >= s.length) throw new Error("Unclosed string in filter: " + s);
      out.push({ t: "val", v }); i = j + 1; continue;
    }
    const m = /^[A-Za-z0-9_.:-]+/.exec(s.slice(i));
    if(!m) throw new Error(`Can't read the filter at "${s.slice(i)}"`);
    const w = m[0];
    if(/^-?\d+(\.\d+)?$/.test(w)) out.push({ t: "val", v: Number(w) });
    else if(w === "true" || w === "false") out.push({ t: "val", v: w === "true" });
    else if(w === "null") out.push({ t: "val", v: null });
    else out.push({ t: "id", v: w });
    i += w.length;
  }
  return out;
}

function parse(s){
  const tk = tokenize(s);
  let p = 0;
  const peek = () => tk[p], next = () => tk[p++];
  const expect = t => { const x = next(); if(!x || x.t !== t) throw new Error(`Expected ${t} in filter: ${s}`); return x; };
  function or(){
    const kids = [and()];
    while(peek()?.t === "||"){ next(); kids.push(and()); }
    return kids.length === 1 ? kids[0] : { or: kids };
  }
  function and(){
    const kids = [primary()];
    while(peek()?.t === "&&"){ next(); kids.push(primary()); }
    return kids.length === 1 ? kids[0] : { and: kids };
  }
  function primary(){
    if(peek()?.t === "("){ next(); const e = or(); expect(")"); return e; }
    const f = expect("id").v, op = expect("op").v, v = next();
    if(!v || v.t !== "val") throw new Error(`Expected a value after ${f} ${op} in filter: ${s}`);
    return { f, op, v: v.v };
  }
  const e = or();
  if(p !== tk.length) throw new Error("Unexpected text at the end of filter: " + s);
  return e;
}

const OPS = { "=": "eq", "!=": "neq", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte", "~": "ilike", "?=": "cs" };

// One comparison -> [column, PostgREST operator, value].
function leaf({ f, op, v }){
  let col = f, o = OPS[op];
  if(!o) throw new Error("Filter operator not supported: " + op);
  if(o === "cs"){
    col = f.replace(/\.id$/, "");                 // "sites.id ?= x": the array holds x
    return [col, "cs", `{${pgQuote(v)}}`];
  }
  if(o === "ilike") return [col, "ilike", "*" + String(v).replace(/%/g, "*") + "*"];
  if(v === null) return [col, o === "eq" ? "is" : "not.is", "null"];
  return [col, o, v];
}
const pgQuote = v => '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

// A group inside or(...): "col.op.value" items, and(...) for nested ANDs.
function orText(node){
  if(node.or) return node.or.map(orItem).join(",");
  return orItem(node);
}
function orItem(node){
  if(node.or) return `or(${orText(node)})`;
  if(node.and) return `and(${node.and.map(orItem).join(",")})`;
  if(node.f.includes(".") && !/\.id$/.test(node.f)) throw new Error("A relation's field can't be used inside ||: " + node.f);
  const [c, o, v] = leaf(node);
  const val = o === "cs" || o === "is" || o === "not.is" ? v : pgQuote(v);
  return `${c}.${o}.${val}`;
}

/* Applies a parsed filter to a query. Top-level ANDs become separate
   filters; an OR becomes .or(...). "session.date" style fields join the
   parent in (an inner join, aliased so the record's own "session" stays
   its id; see collectEmbeds). */
function applyFilter(q, node){
  if(!node) return q;
  if(node.and){ for(const k of node.and) q = applyFilter(q, k); return q; }
  if(node.or) return q.or(orText(node));
  const [col, o, v] = leaf(node);
  const dot = col.indexOf(".");
  if(dot !== -1 && o !== "cs") return q.filter(`_j_${col.slice(0, dot)}.${col.slice(dot + 1)}`, o, v);
  return q.filter(col, o, v);
}

function selectList(fields, embeds){
  let sel = fields ? fields.split(",").map(s => s.trim()).filter(Boolean).map(quoteCol).join(",") : "*";
  for(const [alias, e] of Object.entries(embeds)){
    sel += `,${alias}:${quoteCol(e.rel)}!inner(${[...e.fields].map(quoteCol).join(",")})`;
  }
  return sel;
}
// Reserved words as column names ("group", "end", ...) need quoting in select lists.
const quoteCol = c => /^(group|end|from|to|set|user|order|select)$/.test(c) ? `"${c}"` : c;

const stripEmbeds = rows => {
  for(const r of rows) for(const k of Object.keys(r)) if(k.startsWith("_j_")) delete r[k];
  return rows;
};

function applySort(q, sort){
  if(!sort) return q;
  for(let s of sort.split(",").map(x => x.trim()).filter(Boolean)){
    const desc = s.startsWith("-");
    s = s.replace(/^[-+]/, "");
    q = q.order(s, { ascending: !desc });
  }
  return q;
}

// The relations a filter reaches into ("session.date"), which select()
// has to join in before the filter can use them.
function collectEmbeds(node, embeds){
  if(!node) return embeds;
  if(node.and){ node.and.forEach(k => collectEmbeds(k, embeds)); return embeds; }
  if(node.or) return embeds;
  const [col, o] = leaf(node);
  const dot = col.indexOf(".");
  if(dot !== -1 && o !== "cs"){
    const rel = col.slice(0, dot);
    (embeds["_j_" + rel] ||= { rel, fields: new Set() }).fields.add(col.slice(dot + 1));
  }
  return embeds;
}

function query(table, { filter: f, sort, fields } = {}, count){
  const node = f ? parse(f) : null;
  let q = sb.from(table).select(selectList(fields, collectEmbeds(node, {})), count ? { count: "exact" } : undefined);
  q = applyFilter(q, node);
  return applySort(q, sort);
}

/* ------------------------------------------------------------ collections */

const PAGE = 1000;   // PostgREST's default most rows per request

function collection(name){
  if(name === "users") return {
    async authWithPassword(email, password){
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw new ClientError(400, "Failed to authenticate.");
      session = (await sb.auth.getSession()).data.session;
      try{ setRecord(await loadProfile()); }
      catch(e){ authStore.clear(); throw e; }
      return { token: authStore.token, record };
    },
    async authRefresh(){
      const { data, error } = await sb.auth.refreshSession();
      if(error || !data.session){
        const offline = error && (error.status === undefined || error.status === 0 || error.status >= 500);
        throw new ClientError(offline ? 0 : 401, error?.message || "Signed out.");
      }
      session = data.session;
      setRecord(await loadProfile());
      return { token: authStore.token, record };
    },
  };

  return {
    async getFullList(opts = {}){
      const out = [];
      for(let from = 0; ; from += PAGE){
        const { data, error } = await query(name, opts).range(from, from + PAGE - 1);
        if(error) fail(error);
        out.push(...data);
        if(data.length < PAGE) break;
      }
      return stripEmbeds(out);
    },
    async getList(page = 1, perPage = 30, opts = {}){
      const from = (page - 1) * perPage;
      const { data, error, count } = await query(name, opts, true).range(from, from + perPage - 1);
      if(error) fail(error);
      return { page, perPage, totalItems: count ?? data.length, totalPages: Math.ceil((count ?? 0) / perPage), items: stripEmbeds(data) };
    },
    async getFirstListItem(f, opts = {}){
      const { data, error } = await query(name, { ...opts, filter: f }).limit(1);
      if(error) fail(error);
      if(!data.length) throw new ClientError(404, "The requested resource wasn't found.");
      return stripEmbeds(data)[0];
    },
    async getOne(id, opts = {}){
      const { data, error } = await sb.from(name).select(selectList(opts.fields, {})).eq("id", id).maybeSingle();
      if(error) fail(error);
      if(!data) throw new ClientError(404, "The requested resource wasn't found.");
      return data;
    },
    async create(row){
      const { data, error } = await sb.from(name).insert(row).select().single();
      if(error) fail(error);
      return data;
    },
    async update(id, row){
      const { data, error } = await sb.from(name).update(row).eq("id", id).select();
      if(error) fail(error);
      // Nothing changed: the row isn't there, or isn't yours to change.
      if(!data.length) throw new ClientError(404, "The requested resource wasn't found, or you can't change it.");
      return data[0];
    },
    async delete(id){
      const { data, error } = await sb.from(name).delete().eq("id", id).select("id");
      if(error) fail(error);
      if(!data.length) throw new ClientError(404, "The requested resource wasn't found, or you can't delete it.");
      return true;
    },
  };
}

/* ------------------------------------------------------------ server routes */

// The old /api/... routes live in one Edge Function, "api", under the same
// paths: pb.send("/api/eventbrite/events", { query: { site } }).
export const FN_URL = `${URL_}/functions/v1/api`;

async function send(path, { method = "GET", query: qs, body, headers = {} } = {}){
  let url = FN_URL + path.replace(/^\/api/, "");
  if(qs){
    const u = new URL(url);
    for(const [k, v] of Object.entries(qs)) if(v !== undefined && v !== null) u.searchParams.set(k, v);
    url = u.toString();
  }
  const h = { apikey: KEY, ...headers };
  if(authStore.token) h.Authorization = `Bearer ${authStore.token}`;
  let b;
  if(body !== undefined && !(body instanceof FormData)){ h["Content-Type"] = "application/json"; b = JSON.stringify(body); }
  else b = body;
  let res;
  try{ res = await fetch(url, { method, headers: h, body: b }); }
  catch(e){ throw new ClientError(0, "Couldn't reach the server. Check your connection."); }
  const text = await res.text();
  let data = {};
  try{ data = text ? JSON.parse(text) : {}; }catch{ data = { message: text }; }
  if(!res.ok) throw new ClientError(res.status, data.error || data.message || `The server said ${res.status}.`, data);
  return data;
}

/* ------------------------------------------------------------ files */

// App card images: public files in the "apps" storage bucket, by path.
const files = {
  getURL(_record, path){
    if(!path) return "";
    return `${URL_}/storage/v1/object/public/apps/${String(path).split("/").map(encodeURIComponent).join("/")}`;
  },
};
files.getUrl = files.getURL;

export const pb = { authStore, collection, filter, send, files };
