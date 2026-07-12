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
  // Minimal local date/time parse mirroring TripEntryList._dayMs / _toMin, so
  // itinerary math is unit-testable without customJS at load time.
  static _dayMs(v){
    if(!v) return null;
    const m=String(v).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m?Date.UTC(+m[1],+m[2]-1,+m[3]):null;
  }
  static _toMin(t){
    const m=String(t||"").match(/^(\d{1,2}):(\d{2})$/);
    return m?(+m[1]*60+ +m[2]):null;
  }
  static _legMs(leg){
    const d=TripDashboard._dayMs(leg&&leg.depart_date), t=TripDashboard._toMin(leg&&leg.depart_time);
    return (d==null||t==null)?null:d+t*60000;
  }
  // Group flight legs by direction (Outbound, Return, then any other in
  // first-seen order); build the airport chain per group, collapsing
  // consecutive duplicates. departsMs = min leg-depart across the group.
  static _itinerary(flights){
    const legs=Array.isArray(flights)?flights:[];
    const order=[]; const groups={};
    legs.forEach(l=>{
      if(!l) return;
      const dir=String(l.direction||"").trim()||"Other";
      if(!groups[dir]){ groups[dir]=[]; order.push(dir); }
      groups[dir].push(l);
    });
    const rank=(d)=> d==="Outbound"?0 : d==="Return"?1 : 2;
    order.sort((a,b)=>{ const ra=rank(a), rb=rank(b); return ra!==rb?ra-rb:order.indexOf(a)-order.indexOf(b); });
    const out=[];
    order.forEach(dir=>{
      const gl=groups[dir];
      if(!gl||!gl.length) return;
      const chain=[];
      gl.forEach(l=>{
        if(l.from!=null && l.from!=="") chain.push(String(l.from));
      });
      const last=gl[gl.length-1];
      if(last && last.to!=null && last.to!=="") chain.push(String(last.to));
      const collapsed=[];
      chain.forEach(a=>{ if(collapsed[collapsed.length-1]!==a) collapsed.push(a); });
      const route=collapsed.join(" \u2192 ");
      let departsMs=null;
      gl.forEach(l=>{ const ms=TripDashboard._legMs(l); if(ms!=null && (departsMs==null||ms<departsMs)) departsMs=ms; });
      out.push({direction:dir, route, departsMs});
    });
    return out;
  }
  static _staySummary(stays){
    return (Array.isArray(stays)?stays:[]).filter(s=>s&&s.name).map(s=>({name:String(s.name), check_in:s.check_in||"", check_out:s.check_out||""}));
  }
  // Open trip tasks = task-entity notes in spice/tasks keyed on trip_slug
  // (parity with TaskTripList._matches: open, non-meeting, not trashed/done).
  static _countOpenTasks(dv, tripSlug){
    const slug=String(tripSlug||"").trim(); if(!slug) return 0;
    try {
      const rows=dv.pages('"spice/tasks"').where(p=>p&&p.type==="task"&&p.status==="open"&&String(p.trip_slug||"").trim()===slug&&String(p.source||"").trim()!=="meeting"&&p.file&&!String(p.file.path).includes("/_trash/")&&!String(p.file.path).includes("/_done/"));
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

      // asOf = today's UTC yyyy-mm-dd (once)
      const now=new Date();
      const asOf = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
      const cd = TripDashboard.countdown(page.start_date, page.end_date, asOf);

      // open task count — task-entity notes keyed on trip_slug (parity TaskTripList).
      const tripSlug = page.trip_slug || (String(page.file.path||"").split("/")[2]) || "";
      const openTasks = TripDashboard._countOpenTasks(dv, tripSlug);

      // ── sibling folder-scan: packing_items + flights + stays ──
      let packing=null, flights=null, stays=null;
      try {
        const parts=String(page.file.path||"").split("/"); const ti=parts.indexOf("trips");
        if(ti>0 && parts[ti-1]==="spice" && parts.length===ti+3){ const dir="spice/trips/"+parts[ti+1];
          const folder=app.vault.getAbstractFileByPath(dir);
          if(folder && folder.children){ for(const f of folder.children){ if(f.extension!=="md") continue;
            const fm=app.metadataCache.getFileCache(f)?.frontmatter||{};
            if(fm.type!=="trip-section") continue;
            if(fm.section_kind==="packing-list" && Array.isArray(fm.packing_items)) packing=fm.packing_items;
            else if(fm.section_kind==="flights" && Array.isArray(fm.flights)) flights=fm.flights;
            else if(fm.section_kind==="stay" && Array.isArray(fm.stays)) stays=fm.stays;
          } }
        }
      } catch(_e){ /* sibling scan best-effort */ }

      // shared render helpers ─────────────────────────────────────
      const mkCard=()=>{ const card=c.createEl("div"); card.style.cssText="padding:12px 16px; margin:6px auto; max-width:720px; border:1px solid var(--background-modifier-border); border-radius:10px; background:var(--background-secondary);"; return card; };
      const label=(parent,text)=>{ const l=parent.createEl("div",{text:String(text)}); l.style.cssText="font-size:0.72em; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.03em;"; return l; };
      const header=(parent,text)=>{
        if(customJS.SectionLabel && typeof customJS.SectionLabel.render==="function"){ try{ customJS.SectionLabel.render(parent, text); return; }catch(_e){} }
        const h=parent.createEl("div",{text:String(text)}); h.style.cssText="font-weight:700; font-size:0.82em; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted); margin:2px 0 8px;";
      };

      // ── Hero card ──
      const hero=mkCard();
      const bigWrap=hero.createEl("div"); bigWrap.style.cssText="display:flex; flex-direction:column; gap:2px; margin-bottom:10px;";
      let bigVal, bigLabel="";
      if(cd.state==="upcoming"){ bigVal=String(cd.days); bigLabel="days to go"; }
      else if(cd.state==="in-progress"){ bigVal="In progress"; }
      else if(cd.state==="complete"){ bigVal="Complete"; }
      else { bigVal="—"; }
      const bv=bigWrap.createEl("div",{text:bigVal}); bv.style.cssText="font-weight:800; font-size:1.9em; line-height:1.05; color:var(--interactive-accent);";
      if(bigLabel) label(bigWrap,bigLabel);

      const stats=hero.createEl("div"); stats.style.cssText="display:flex; flex-wrap:wrap; gap:16px; align-items:flex-start;";
      const stat=(lbl,value)=>{ const w=stats.createEl("div"); w.style.cssText="display:flex; flex-direction:column; gap:2px;"; const v=w.createEl("div",{text:String(value)}); v.style.cssText="font-weight:700; font-size:1.02em;"; label(w,lbl); };
      stat("dates", TripDashboard._fmtDate(page.start_date)+" – "+TripDashboard._fmtDate(page.end_date));
      if(page.location) stat("where", page.location);
      stat("open tasks", openTasks);

      // ── Itinerary (Flights) block — omitted when no legs ──
      const itin=TripDashboard._itinerary(flights);
      if(itin.length){
        const fc=mkCard(); header(fc,"Flights");
        itin.forEach(g=>{
          const row=fc.createEl("div"); row.style.cssText="display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:3px 0;";
          const dep=g.departsMs!=null?(" · departs "+TripDashboard._fmtDate(g.departsMs)):"";
          const t=row.createEl("div",{text:g.direction+" · "+g.route+dep}); t.style.cssText="font-size:0.95em;";
          try {
            const TEL=(typeof customJS!=="undefined")&&customJS.TripEntryList;
            const grp=(flights||[]).filter(l=>l && (String(l.direction||"").trim()||"Other")===g.direction);
            const firstLeg=grp[0];
            if(TEL && typeof TEL._flightStatus==="function" && firstLeg){
              const st=TEL._flightStatus(firstLeg, Date.now());
              if(st && st.label){
                const pill=row.createEl("span",{text:st.label});
                const tone=st.tone==="warn"?"var(--color-yellow)":st.tone==="muted"?"var(--text-muted)":"var(--interactive-accent)";
                pill.style.cssText="font-size:0.68em; text-transform:uppercase; letter-spacing:0.03em; padding:1px 7px; border-radius:8px; border:1px solid "+tone+"; color:"+tone+";";
              }
            }
          } catch(_e){ /* status pill best-effort */ }
        });
      }

      // ── Stay block — omitted when no stays ──
      const ss=TripDashboard._staySummary(stays);
      if(ss.length){
        const sc=mkCard(); header(sc,"Stay");
        ss.forEach(s=>{
          const row=sc.createEl("div"); row.style.cssText="font-size:0.95em; padding:3px 0;";
          const rng=(s.check_in||s.check_out)?(" · "+TripDashboard._fmtDate(s.check_in)+" → "+TripDashboard._fmtDate(s.check_out)):"";
          row.createEl("span",{text:s.name+rng});
        });
      }

      // ── Packing block — omitted when no packable items ──
      if(packing && Array.isArray(packing) && packing.length){
        const pc=TripDashboard.packingCounts(packing);
        const cats=Object.keys(pc);
        if(cats.length){
          const packed=cats.reduce((a,k)=>a+pc[k].checked,0);
          const tot=cats.reduce((a,k)=>a+pc[k].total,0);
          if(tot>0){
            const kc=mkCard(); header(kc,"Packing");
            const line=kc.createEl("div",{text:packed+"/"+tot+" packed"}); line.style.cssText="font-size:0.95em; margin-bottom:6px;";
            const pct=Math.max(0,Math.min(100,Math.round((packed/tot)*100)));
            const bar=kc.createEl("div"); bar.style.cssText="height:8px; border-radius:6px; background:var(--background-modifier-border); overflow:hidden;";
            const fill=bar.createEl("div"); fill.style.cssText="height:100%; width:"+pct+"%; background:var(--interactive-accent);";
            const sub=cats.map(k=>k+" "+pc[k].checked+"/"+pc[k].total).join(" · ");
            if(sub){ const sl=kc.createEl("div",{text:sub}); sl.style.cssText="font-size:0.72em; color:var(--text-muted); margin-top:6px;"; }
          }
        }
      }
    } catch(_e){ /* never throw */ }
  }
}
