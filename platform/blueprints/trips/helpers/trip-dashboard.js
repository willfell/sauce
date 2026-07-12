class TripDashboard {
  static _utc(s){ const m=String(s||"").slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?Date.UTC(+m[1],+m[2]-1,+m[3]):null; }
  static countdown(start,end,asOf){
    const DAY=86400000;
    const s=TripDashboard._utc(start), e=TripDashboard._utc(end), n=TripDashboard._utc(asOf);
    if(s==null||n==null) return {state:"unknown", days:null};
    if(n<s) return {state:"upcoming", days:Math.round((s-n)/DAY)};
    if(e!=null && n>e) return {state:"complete", days:Math.round((n-e)/DAY)};
    return {state:"in-progress", days:e!=null?Math.round((e-n)/DAY):0};
  }
  static _fmtDate(v){
    if(v===null||v===undefined||v==="") return "";
    const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    let d=null;
    if(typeof v==="string" && /^\d{4}-\d{2}-\d{2}/.test(v)){
      const ms=TripDashboard._utc(v);
      if(ms==null) return "";
      d=new Date(ms);
    } else if(typeof v==="number"){
      d=new Date(v);
    } else if(v instanceof Date){
      d=v;
    } else if(v && typeof v==="object"){
      const ms=(typeof v.toMillis==="function")?v.toMillis():(v.ts!=null?v.ts:v);
      d=new Date(ms);
    }
    if(!d || isNaN(d.getTime())) return "";
    return MONTHS[d.getUTCMonth()]+" "+d.getUTCDate()+", "+d.getUTCFullYear();
  }
  static packingCounts(items){
    const out={}; (Array.isArray(items)?items:[]).forEach(it=>{ if(!it||!it.item) return; const c=it.category||"Uncategorized"; out[c]=out[c]||{total:0,checked:0}; out[c].total++; if(it.checked) out[c].checked++; }); return out;
  }
  // Open trip tasks = task-entity notes in spice/tasks keyed on trip_slug
  // (parity with TaskTripList._matches: open, non-meeting, not trashed/done).
  static _countOpenTasks(dv, tripSlug){
    const slug=String(tripSlug||"").trim(); if(!slug) return 0;
    try {
      const rows=dv.pages('"spice/tasks"').where(p=>p&&p.type==="task"&&p.status==="open"&&String(p.trip_slug||"").trim()===slug&&String(p.source||"").trim()!=="meeting"&&!String(p.file.path).includes("/_trash/")&&!String(p.file.path).includes("/_done/"));
      return rows?(rows.length||0):0;
    } catch(_e){ return 0; }
  }
  async render(dv){
    try {
      const page = customJS.RenderSafe.page(dv);
      if(!page || !page.file || page.type!=="trip") return;
      const c=(dv&&dv.container)?dv.container:dv;
      if(!c||typeof c.createEl!=="function") return;
      if(c.closest && c.closest(".markdown-embed")) return;
      // asOf = today's UTC yyyy-mm-dd
      const now=new Date();
      const asOf = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
      const cd = TripDashboard.countdown(page.start_date, page.end_date, asOf);
      // sibling packing note via folder scan (pattern: TripSectionsCards)
      let packing=[];
      try {
        const parts=String(page.file.path||"").split("/"); const ti=parts.indexOf("trips");
        if(ti>0 && parts[ti-1]==="spice" && parts.length===ti+3){ const dir="spice/trips/"+parts[ti+1];
          const folder=app.vault.getAbstractFileByPath(dir);
          if(folder && folder.children){ for(const f of folder.children){ if(f.extension==="md"){ const fm=app.metadataCache.getFileCache(f)?.frontmatter||{}; if(fm.type==="trip-section" && fm.section_kind==="packing-list" && Array.isArray(fm.packing_items)){ packing=fm.packing_items; break; } } } }
        }
      } catch(_e){}
      const pc = TripDashboard.packingCounts(packing);
      // open task count — trip tasks are task-entity notes keyed on trip_slug
      // (parity with TaskTripList), not the retired inline [trip::] field.
      const tripSlug = page.trip_slug || (String(page.file.path||"").split("/")[2]) || "";
      const openTasks = TripDashboard._countOpenTasks(dv, tripSlug);
      // ---- draw a compact card ----
      const card=c.createEl("div"); card.style.cssText="display:flex; flex-wrap:wrap; gap:14px; align-items:center; padding:10px 14px; margin:4px auto 2px; max-width:720px; border:1px solid var(--background-modifier-border); border-radius:10px; background:var(--background-secondary);";
      const stat=(label,value)=>{ const w=card.createEl("div"); w.style.cssText="display:flex; flex-direction:column; gap:2px;"; const v=w.createEl("div",{text:String(value)}); v.style.cssText="font-weight:700; font-size:1.05em;"; const l=w.createEl("div",{text:label}); l.style.cssText="font-size:0.72em; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.03em;"; };
      if(cd.state==="upcoming") stat("days to go", cd.days);
      else if(cd.state==="in-progress") stat("status","In progress");
      else if(cd.state==="complete") stat("status","Complete");
      const dates = TripDashboard._fmtDate(page.start_date)+" – "+TripDashboard._fmtDate(page.end_date);
      stat("dates", dates);
      if(page.location) stat("where", page.location);
      stat("open tasks", openTasks);
      const cats=Object.keys(pc); if(cats.length){ const packed=cats.reduce((a,k)=>a+pc[k].checked,0); const tot=cats.reduce((a,k)=>a+pc[k].total,0); stat("packed", packed+"/"+tot); }
    } catch(_e){ /* never throw */ }
  }
}
