/* PDF quotes and invoices - an A4 drawing of the same document model the
   pop-up shows (see common.js), ported from the standalone Invoicer.

   jsPDF is vendored (js/vendor/jspdf.umd.min.js) and only loaded the first
   time someone downloads a PDF. The logo is whatever the page's banner
   shows - the logo image, or for a site without one its wordmark (the
   banner is the only place branding lives). */

let jspdfLoading = null;
function loadJsPDF(){
  if(window.jspdf) return Promise.resolve(window.jspdf);
  if(!jspdfLoading) jspdfLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/vendor/jspdf.umd.min.js";
    s.onload = () => window.jspdf ? resolve(window.jspdf) : reject(new Error("jsPDF did not load"));
    s.onerror = () => { jspdfLoading = null; reject(new Error("Could not load the PDF tool")); };
    document.head.appendChild(s);
  });
  return jspdfLoading;
}

// The banner logo as a PNG data URL plus its aspect ratio, or null. For a
// site without its own logo, its wordmark (the banner's #brand-mark, from
// core/site.js) drawn the same way: the name bold in the site's colour, the
// full name under it in grey. Cached per site.
const logoCache = new Map();
async function bannerLogo(){
  const img = document.querySelector("#brand-logo");
  const mark = document.querySelector("#brand-mark");
  if(mark && !mark.hidden) return wordmark(mark);
  if(!img) return null;
  if(logoCache.has("img")) return logoCache.get("img");
  let out = null;
  try{
    if(!img.complete) await new Promise(r => { img.onload = r; img.onerror = r; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    if(c.width && c.height){
      c.getContext("2d").drawImage(img, 0, 0);
      out = { data: c.toDataURL("image/png"), ratio: c.width / c.height };
    }
  }catch{ /* no logo rather than no PDF */ }
  logoCache.set("img", out);
  return out;
}
function wordmark(mark){
  const name = mark.querySelector(".nm").textContent, sub = mark.querySelector(".sub").textContent;
  const colour = getComputedStyle(mark).getPropertyValue("--site").trim() || "#0e7c86";
  const key = [name, sub, colour].join("|");
  if(logoCache.has(key)) return logoCache.get(key);
  let out = null;
  try{
    // 4x the banner's 40px / 11px type, for a sharp print.
    const font = w => `${w} ${"system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"}`;
    const c = document.createElement("canvas"), g = c.getContext("2d");
    g.font = font("800 160px");
    const nameW = g.measureText(name).width;
    g.font = font("600 44px");
    const subW = sub ? g.measureText(sub).width : 0;
    c.width = Math.ceil(Math.max(nameW, subW, 680)) + 8;
    c.height = sub ? 296 : 200;
    g.textBaseline = "top";
    g.fillStyle = colour; g.font = font("800 160px"); g.fillText(name, 0, 12);
    if(sub){ g.fillStyle = "#6E6E73"; g.font = font("600 44px"); g.fillText(sub, 4, 196); }
    out = { data: c.toDataURL("image/png"), ratio: c.width / c.height };
  }catch{ out = null; }
  logoCache.set(key, out);
  return out;
}

function buildPdf(jspdf, m, logo){
  const doc = new jspdf.jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 20, right = W - M;
  const ink = [29, 29, 31], grey = [110, 110, 115], hair = [229, 229, 234];
  const text = (t, x, y, o = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size || 10);
    doc.setTextColor(...(o.color || ink)); doc.text(String(t), x, y, o.align ? { align: o.align } : undefined);
  };
  const rule = y => { doc.setDrawColor(...hair); doc.setLineWidth(0.25); doc.line(M, y, right, y); };

  // Logo top right, 45 mm wide.
  let lw = 0, lh = 0;
  if(logo){ lw = 45; lh = lw / logo.ratio; doc.addImage(logo.data, "PNG", right - lw, 14, lw, lh, "logo", "FAST"); }

  let y = 26;
  text(m.title, M, y, { size: 24, bold: true });
  y += 7;
  doc.setFontSize(9);
  doc.splitTextToSize(m.meta, right - (lw ? lw + 8 : 0) - M).forEach(t => { text(t, M, y, { size: 9, color: grey }); y += 4.5; });
  y = Math.max(y, 14 + lh) + 12;

  m.facts.forEach(([k, v]) => {
    doc.setFontSize(10);
    const vs = doc.splitTextToSize(String(v || ""), right - (M + 38));
    text(k, M, y, { color: grey });
    vs.forEach((t, i) => text(t, M + 38, y + i * 5));
    y += 5 * Math.max(vs.length, 1) + 1.5;
  });
  y += 6; rule(y);
  m.lines.forEach(l => {
    y += 6.5;
    text(l.name, M, y);
    if(l.sub){
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      text(l.sub, M + doc.getTextWidth(l.name) + 3, y, { size: 9, color: grey });
    }
    text(l.amount, right, y, { align: "right" });
    y += 3.5; rule(y);
    if(y > 260){ doc.addPage(); y = 20; }
  });
  m.rows.forEach(([k, v]) => { y += 6.5; text(k, M, y, { color: grey }); text(v, right, y, { align: "right" }); y += 3.5; rule(y); });
  y += 10;
  text(m.total[0], M, y, { size: 12, bold: true });
  text(m.total[1], right, y, { size: 18, bold: true, align: "right" });
  if(m.note){
    y += 9; doc.setFontSize(9);
    doc.splitTextToSize(m.note, right - M).forEach(t => { text(t, M, y, { size: 9, color: grey }); y += 4.5; });
  }
  if(m.terms){
    y += 8;
    text(m.terms.lead, M, y, { size: 9, color: grey }); y += 5;
    m.terms.items.forEach(it => { text("•", M + 1, y, { size: 9, color: grey }); text(it, M + 5, y, { size: 9, color: grey }); y += 4.5; });
    if(m.terms.after){ y += 1.5; text(m.terms.after, M, y, { size: 9, color: grey }); }
  }
  return doc.output("blob");
}

// Builds the PDF for a document model and starts a normal browser download.
export async function downloadPdf(m){
  const [jspdf, logo] = await Promise.all([loadJsPDF(), bannerLogo()]);
  const name = (m.file.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || m.title) + ".pdf";
  const url = URL.createObjectURL(buildPdf(jspdf, m, logo));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
