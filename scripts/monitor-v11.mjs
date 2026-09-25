import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) process.exit(1);

const REST = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;
const MODE = (process.env.MONITOR_MODE || "full").toLowerCase();
const SOURCE_LIMIT = Number(process.env.SOURCE_LIMIT || 0);
const SOURCE_OFFSET = Number(process.env.SOURCE_OFFSET || 0);
const SOURCE_NAMES = (process.env.SOURCE_NAMES || "").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);

const CFG = {
  concurrency: 4,
  defaultMaxPages: 14,
  defaultMaxDepth: 3,
  sourceTimeout: 18000,
  pageTimeout: 14000,
  curlTimeout: 14,
  maxPdfBytes: 25 * 1024 * 1024,
  maxLinksPerPage: 100,
  sourceBudgetMs: 120000,
  userAgent: "FoundrymanJobsMonitor/11.0 (targeted-discovery)",
  foundry: [
    "foundryman","foundry man","foundry-man","moulder","molder",
    "foundry worker","foundry trade","foundry operator","foundry technician",
    "foundry fitter","foundry","moulding","molding","core maker","melter","fettler"
  ],
  strong: ["foundryman","foundry man","foundry-man","moulder","molder","foundry operator","foundry technician"],
  recruitment: ["recruitment","recruit","vacancy","vacancies","career","careers","job","jobs","advertisement","advt","notification","notice","engagement","selection","apprentice","apprenticeship","application","employment","iti","trade"],
  exclude: ["result","answer-key","answer key","admit-card","admit card","corrigendum","withdrawal","cancellation","seniority","merit-list","merit list","response sheet"],
  aggregators: [
    {name:"LinkingSky", url:"https://linkingsky.com/government-exams/ITI_Jobs.html"},
    {name:"FreeJobAlert", url:"https://www.freejobalert.com/"},
    {name:"SarkariResult", url:"https://www.sarkariresult.com/"}
  ]
};

const clean = v => String(v||"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
const trunc = (v,n=1400) => { const s=clean(v); return s.length>n?s.slice(0,n)+"…":s; };
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const http = u => /^https?:\/\//i.test(u);
const domainLocks = new Map();
const domainNextAt = new Map();
const domainFailures = new Map();

async function withDomainLock(url, fn){
  const h=host(url);
  if(!h)return fn();
  const prev=domainLocks.get(h)||Promise.resolve();
  let release;
  const gate=new Promise(r=>{release=r});
  const queued=prev.then(()=>gate);
  domainLocks.set(h,queued);
  await prev;
  try{
    const next=domainNextAt.get(h)||0;
    if(next>Date.now())await sleep(next-Date.now());
    domainNextAt.set(h,Date.now()+450);
    return await fn();
  }finally{
    release();
    if(domainLocks.get(h)===queued)domainLocks.delete(h);
  }
}
function transientError(err){
  const m=String(err?.message||err||"").toLowerCase();
  return /http (429|502|503|504)\b|timed? ?out|timeout|aborted|abort|fetch failed|network|socket|econn|enotfound|reset|curl exit/.test(m);
}
function retryAfterMs(value){
  const s=String(value||"").trim();
  if(!s)return 0;
  const n=Number(s);
  if(Number.isFinite(n))return Math.min(15000,Math.max(0,n*1000));
  const t=Date.parse(s);
  return Number.isNaN(t)?0:Math.min(15000,Math.max(0,t-Date.now()));
}
const host = u => { try{return new URL(u).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""} };
const pdf = u => /\.pdf(?:$|[?#])/i.test(u);
const normalize = (u,b) => { try{return new URL(u,b).href.split("#")[0]}catch{return null} };
const canonicalUrl = u => { try { const x=new URL(u); x.hash=""; for(const k of [...x.searchParams.keys()]) if(/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(k)) x.searchParams.delete(k); return x.href.replace(/\/$/,"").toLowerCase(); } catch { return String(u||"").toLowerCase().replace(/\/$/,""); } };
const normalizedTitle = v => clean(v).toLowerCase().replace(/\b(advt?|advertisement|notification|notice|recruitment|vacancy|vacancies)\b/g," ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();

function termsIn(text, terms=CFG.foundry) {
  const l=clean(text).toLowerCase();
  return terms.filter(t=>l.includes(t));
}
function score(title,url,text) {
  const a=(clean(title)+" "+url+" "+clean(text)).toLowerCase(), head=(clean(title)+" "+url).toLowerCase(), body=clean(text).toLowerCase();
  const strongHead=CFG.strong.some(t=>head.includes(t)), strongBody=CFG.strong.some(t=>body.includes(t));
  const foundryEvidence=CFG.foundry.some(t=>a.includes(t));
  const recruitHit=CFG.recruitment.some(t=>a.includes(t)), tradeHit=/\b(iti|ncvt|scvt|ntc|nac|apprentice|trade certificate)\b/i.test(a);
  let s=strongHead?55:(strongBody?45:(foundryEvidence?25:0));
  if(recruitHit)s+=15; if(tradeHit)s+=15; if(pdf(url))s+=5; if(isClosed(text))s-=10;
  return Math.max(0,Math.min(100,s));
}
function context(text) {
  const s=clean(text), l=s.toLowerCase();
  let idx=-1, term="";
  for(const t of CFG.foundry){const i=l.indexOf(t);if(i>=0&&(idx<0||i<idx)){idx=i;term=t;}}
  return idx<0?"":trunc(`[matched: ${term}] ${s.slice(Math.max(0,idx-500),idx+1200)}`,1800);
}
function deadline(text) {
  const s=clean(text);
  const pats=[/last\s+date.{0,140}/i,/closing\s+date.{0,140}/i,/application\s+deadline.{0,140}/i,/apply\s+(?:online\s+)?(?:before|by).{0,140}/i];
  for(const p of pats){const m=s.match(p);if(m)return trunc(m[0],500);}
  return "";
}
function qualification(text){
  const s=clean(text),l=s.toLowerCase();
  const ts=["iti","ncvt","scvt","ntc","nac","industrial training institute","trade qualification"];
  let idx=-1;for(const t of ts){const i=l.indexOf(t);if(i>=0&&(idx<0||i<idx))idx=i;}
  return idx<0?"":trunc(s.slice(Math.max(0,idx-250),idx+1000),1300);
}
function fingerprint(url,title,organization=""){
  return crypto.createHash("sha256").update(canonicalUrl(url)+"|"+normalizedTitle(title)+"|"+clean(organization).toLowerCase()).digest("hex");
}
function explicitClosed(text){ const s=clean(text).toLowerCase(); return /registration\s+closed|application\s+is\s+over|last\s+date\s+.*expired|deadline\s+.*expired|applications?\s+closed/.test(s); }
function parseDeadlineDate(text){
  const s=clean(text);
  const m=s.match(/(?:last\s+date|closing\s+date|deadline|apply[^.]{0,30}(?:before|by))[^\d]{0,80}(\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i);
  if(!m)return null;
  const raw=m[1].replace(/\//g,"-"); let d;
  if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) d=new Date(raw+"T23:59:59Z");
  else if(/^\d{1,2}-\d{1,2}-\d{4}$/.test(raw)){const [dd,mm,yy]=raw.split("-");d=new Date(yy+"-"+mm.padStart(2,"0")+"-"+dd.padStart(2,"0")+"T23:59:59Z");}
  else d=new Date(raw+" 23:59:59 UTC");
  return Number.isNaN(d.getTime())?null:d;
}
function isClosed(text){ if(explicitClosed(text))return true; const d=parseDeadlineDate(text); return !!(d&&d.getTime()<Date.now()); }

async function api(path,opts={},label=path){
  for(let i=1;i<=3;i++){
    try{
      const r=await fetch(`${REST}/${path}`,{
        ...opts,redirect:"follow",
        headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,Accept:"application/json","Content-Type":"application/json",...(opts.headers||{})}
      });
      const raw=await r.text();
      if(!r.ok) throw new Error(`${label}: HTTP ${r.status} ${trunc(raw,400)}`);
      return raw.trim()?JSON.parse(raw):null;
    }catch(e){if(i===3)throw e;await sleep(600*i);}
  }
}
const get=(p,l)=>api(p,{},l);
const post=(p,b,l)=>api(p,{method:"POST",body:JSON.stringify(b),headers:{Prefer:"return=representation"}},l);
const patch=(p,b,l)=>api(p,{method:"PATCH",body:JSON.stringify(b),headers:{Prefer:"return=minimal"}},l);

async function fetchUrl(url, timeout, label){
  const h=host(url);
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const result=await withDomainLock(url,async()=>{
        let responseError=null;
        try{
          const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),timeout);
          const r=await fetch(url,{redirect:"follow",signal:ctl.signal,headers:{
            "User-Agent":CFG.userAgent,Accept:"text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8","Accept-Language":"en-IN,en;q=0.9"
          }});
          clearTimeout(timer);
          const buf=Buffer.from(await r.arrayBuffer());
          if(r.ok&&buf.length)return {status:r.status,type:r.headers.get("content-type")||"",url:r.url||url,buffer:buf};
          const ra=r.headers.get("retry-after")||"";
          responseError=new Error("HTTP "+r.status+(ra?" RETRY-AFTER "+ra:""));
        }catch(e){responseError=e;}
        if(String(responseError?.message||"").toLowerCase().includes("abort"))throw responseError;
        const args=["-L","--compressed","--silent","--show-error","--connect-timeout","8","--max-time",String(Math.min(CFG.curlTimeout,Math.max(4,Math.ceil(timeout/1000)+1))),"-A",CFG.userAgent,"-H","Accept: text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8","-w","\\n__STATUS__:%{http_code}\\n__TYPE__:%{content_type}\\n__URL__:%{url_effective}\\n",url];
        const r=await new Promise((resolve,reject)=>{
          const p=spawn("curl",args),o=[],err=[];
          p.stdout.on("data",d=>o.push(d));p.stderr.on("data",d=>err.push(d));
          p.on("error",reject);p.on("close",code=>{
            const raw=Buffer.concat(o).toString(), stderr=Buffer.concat(err).toString();
            const m=raw.match(/\\n__STATUS__:(\\d+)/), tm=raw.match(/\\n__TYPE__:(.*?)\\s*$/m), um=raw.match(/\\n__URL__:(.*?)\\s*$/m);
            let end=raw.length;
            for(const marker of ["\\n__STATUS__:","\\n__TYPE__:","\\n__URL__:"]){const i=raw.indexOf(marker);if(i>=0)end=Math.min(end,i);}
            const body=Buffer.from(raw.slice(0,end)), status=m?+m[1]:0;
            if(code!==0&&body.length===0)return reject(new Error("curl exit "+code+": "+trunc(stderr,300)));
            resolve({status,type:tm?tm[1].trim():"",url:um?um[1].trim():url,buffer:body});
          });
        });
        if(r.status>=200&&r.status<400&&r.buffer.length)return r;
        throw new Error("HTTP "+(r.status||"unknown"));
      });
      domainFailures.delete(h);
      return result;
    }catch(e){
      const msg=String(e?.message||e);
      if(!transientError(e)||attempt===3)throw e;
      const ra=(msg.match(/RETRY-AFTER\s+([^\s]+)/i)||[])[1];
      const retryMs=retryAfterMs(ra);
      const failures=(domainFailures.get(h)||0)+1;
      domainFailures.set(h,failures);
      const cooldown=failures>=2?30000:0;
      domainNextAt.set(h,Math.max(domainNextAt.get(h)||0,Date.now()+cooldown));
      await sleep(Math.max(retryMs,attempt===1?1000:2500));
    }
  }
  throw new Error("fetch failed: "+label);
}

async function extractPdf(buf,url){
  if(buf.length>CFG.maxPdfBytes)throw new Error("PDF_TOO_LARGE");
  const file=`/tmp/foundryman-${crypto.randomUUID()}.pdf`;await fs.writeFile(file,buf);
  try{
    return await new Promise((resolve,reject)=>{
      const p=spawn("pdftotext",["-layout",file,"-"]),o=[],e=[];p.stdout.on("data",d=>o.push(d));p.stderr.on("data",d=>e.push(d));
      p.on("error",reject);p.on("close",c=>c?reject(new Error(`PDF_PARSE ${trunc(Buffer.concat(e).toString(),300)}`)):resolve(clean(Buffer.concat(o).toString())));
    });
  }finally{await fs.rm(file,{force:true}).catch(()=>{});}
}

function parseHtml(raw,base){
  const title=clean((raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"");
  const text=clean(raw.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<noscript[\s\S]*?<\/noscript>/gi," ").replace(/<svg[\s\S]*?<\/svg>/gi," ").replace(/<[^>]+>/g," "));
  const links=[],seenLinks=new Set();
  const addLink=(rawUrl,label="")=>{
    const u=normalize(rawUrl,base);
    if(!http(u)||seenLinks.has(u)||links.length>=CFG.maxLinksPerPage)return;
    seenLinks.add(u);links.push({url:u,text:clean(label)});
  };
  const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(raw))&&links.length<CFG.maxLinksPerPage)addLink(m[1],m[2].replace(/<[^>]+>/g," "));
  const attrRe=/(?:href|data-href|data-url|data-download|src)\s*=\s*["']([^"']+)["']/gi;
  while((m=attrRe.exec(raw))&&links.length<CFG.maxLinksPerPage){
    const u=m[1];
    if(/\.pdf(?:$|[?#])|\/(?:uploads?|documents?|download(?:s)?|sites\/default\/files|wp-content\/uploads)\//i.test(u))addLink(u,"document");
  }
  return {title,text,links};
}

function sitemapCandidates(xml,base){
  const out=[],seen=new Set(),re=/<(?:loc)>([\s\S]*?)<\/(?:loc)>/gi;let m;
  while((m=re.exec(xml))&&out.length<2500){
    const u=normalize(m[1].trim(),base);if(!http(u)||seen.has(u))continue;
    const v=u.toLowerCase();
    if(/foundry|moulder|molder|vacanc|recruit|career|job|apprentice|notification|advertisement|iti|\.pdf|uploads|documents|download|employment/.test(v)){seen.add(u);out.push(u);}
  }
  return out;
}
async function discoverSitemaps(rootUrls){
  const out=[],seen=new Set(),roots=[...new Set(rootUrls.map(u=>{try{const x=new URL(u);return x.origin}catch{return null}}).filter(Boolean))];
  for(const origin of roots){
    const candidates=[origin+"/robots.txt",origin+"/sitemap.xml"];
    for(const u of candidates){
      try{
        const g=await fetchUrl(u,2500,"sitemap discovery");
        const raw=g.buffer.toString("utf8");
        if(!/<sitemap|<urlset|Sitemap:/i.test(raw))continue;
        const declared=[...raw.matchAll(/(?:Sitemap:\s*|<loc>)(https?:\/\/[^<\s]+)(?:<\/loc>)?/gi)].map(m=>m[1]);
        const maps=[u,...declared].filter((x,i,a)=>http(x)&&a.indexOf(x)===i).slice(0,3);
        for(const sm of maps){
          try{
            const sg=sm===u?g:await fetchUrl(sm,2500,"sitemap document");
            for(const x of sitemapCandidates(sg.buffer.toString("utf8"),sm))if(!seen.has(x)){seen.add(x);out.push(x);}
          }catch{}
        }
      }catch{}
      if(out.length>=2500)break;
    }
  }
  return out.slice(0,2500);
}

function linkRank(l){
  const v=(clean(l.text)+" "+l.url).toLowerCase();let n=0;
  if(/foundryman|foundry[ -]?man|moulder|molder/.test(v))n+=100;
  if(/foundry|apprentice|vacancy|recruitment|notification|advertisement|iti/.test(v))n+=50;
  if(/\.pdf(?:$|[?#])|uploads|documents|download|sites\/default\/files|wp-content\/uploads/.test(v))n+=45;
  if(/career|job|employment|view|details/.test(v))n+=15;
  return n;
}
function crawlable(l){
  const v=(clean(l.text)+" "+l.url).toLowerCase();
  if(CFG.exclude.some(x=>v.includes(x)))return false;
  return /foundry|moulder|molder|recruit|vacanc|career|job|apprentice|notification|advertisement|iti|\.pdf|uploads|documents|download|sites\/default\/files|wp-content\/uploads/.test(v);
}

async function candidate({sourceId,runId,sourceName,organization="",url,title,text,documentType,status,discoveryMethod,verificationUrl}){
  const matched=termsIn(title+" "+url+" "+text), head=(clean(title)+" "+url).toLowerCase(), body=clean(text).toLowerCase();
  const strongHit=CFG.strong.some(t=>head.includes(t)), recruit=CFG.recruitment.some(t=>body.includes(t)||clean(title).toLowerCase().includes(t));
  const trade=/\b(iti|ncvt|scvt|ntc|nac|apprentice|trade certificate)\b/i.test(body), sc=score(title,url,text);
  const bodyStrongHit=CFG.strong.some(t=>body.includes(t));
  const foundryRecruitTrade=CFG.foundry.some(t=>body.includes(t)) && recruit && trade;
  const evidenceHit=matched.length>0;
  if(!evidenceHit)return false;
  if(CFG.exclude.some(x=>head.includes(x))&&!strongHit){
    console.log("[CANDIDATE-SKIP]",sourceName,"reason=excluded", "title="+trunc(title,120), "url="+canonicalUrl(url));
    return false;
  }
  // Preserve strong official Foundryman evidence for review; weaker matches still need contextual vacancy/trade evidence.
  if(!strongHit && !bodyStrongHit && !foundryRecruitTrade && sc<60){
    console.log("[CANDIDATE-SKIP]",sourceName,"reason=weak-evidence","score="+sc,"terms="+matched.join("|"),"title="+trunc(title,120));
    return false;
  }
  const canonical=canonicalUrl(url), fp=fingerprint(canonical,title,organization);
  const existing=await get("vacancy_candidates?select=id&fingerprint=eq."+encodeURIComponent(fp)+"&limit=1","candidate dedupe").catch(e=>{
    console.log("[CANDIDATE-DEDUPE-ERROR]",sourceName,e.message);
    return [];
  });
  if(Array.isArray(existing)&&existing.length){
    console.log("[CANDIDATE-SKIP]",sourceName,"reason=duplicate","title="+trunc(title,120),"url="+canonical);
    return false;
  }
  const closed=isClosed(text), contentHash=crypto.createHash("sha256").update(clean(text)).digest("hex");
  const row={
    source_id:sourceId||null,monitoring_run_id:runId,discovered_at:new Date().toISOString(),
    title:trunc(title,500)||sourceName||"Foundryman-related opportunity",url:canonical,
    matched_keywords:matched.join(", "),snippet:context(text)||trunc(text,1000),
    source_status:status,eligibility_status:closed?"Closed/Expired":"Needs Verification",review_status:"Pending Review",fingerprint:fp,
    document_type:documentType,matched_context:context(text),confidence_score:sc,deadline_text:deadline(text),
    qualification_text:qualification(text),document_title:trunc(title,500),content_hash:contentHash,
    discovery_method:discoveryMethod,verification_url:verificationUrl||canonical
  };
  try{
    await post("vacancy_candidates",row,"candidate "+sourceName);
    console.log("[CANDIDATE-INSERT]",sourceName,"score="+sc,"closed="+closed,"type="+documentType,"title="+trunc(title,120),"url="+canonical);
    return true;
  }catch(e){
    if(String(e).includes("23505")||String(e).toLowerCase().includes("duplicate")){
      console.log("[CANDIDATE-SKIP]",sourceName,"reason=insert-duplicate","title="+trunc(title,120),"url="+canonical);
      return false;
    }
    console.log("[CANDIDATE-ERROR]",sourceName,e.message);
    return false;
  }}
}

function strategy(source){
  const n=(source.source_name||"").toLowerCase(), t=(source.source_type||"").toLowerCase();
  if(/railway|rrb|rrc/.test(n))return {pages:22,depth:4};
  if(/psc|commission|selection board|employment/.test(n)||t.includes("employment"))return {pages:18,depth:4};
  if(/bhel|hal|drdo|csir|spmcil|isro|defence|atomic|shipyard|psu/.test(n))return {pages:18,depth:4};
  if(/apprenticeship|skill|dgt|iti/.test(n))return {pages:20,depth:4};
  return {pages:14,depth:3};
}

async function processSource(source,run,state){
  const urls=[...(Array.isArray(source.alternate_urls)?source.alternate_urls:[]),source.recruitment_url,source.official_url].filter((u,i,a)=>http(u)&&a.indexOf(u)===i);
  if(!urls.length){state.errors++;return;}
  const st=strategy(source), q=[],seen=new Set(),queued=new Set(),hosts=new Set(urls.map(host)); 
  const push=(url,title="",depth=0,isRoot=false)=>{if(!url||!http(url)||queued.has(url)||seen.has(url))return;const h=host(url);if(![...hosts].some(x=>h===x||h.endsWith("."+x)||x.endsWith("."+h)))return;queued.add(url);q.push({url,title,depth,isRoot});};
  urls.forEach(u=>push(u,"Recruitment",0,true));
  try{
    const sitemapUrls=await discoverSitemaps(urls);
    for(const u of sitemapUrls)push(u,"sitemap document",1,false);
    if(sitemapUrls.length)console.log(`[SITEMAP] ${source.source_name} discovered=${sitemapUrls.length}`);
  }catch{}
  const started=Date.now();
  let pages=0,errors=0,warnings=0;
  console.log(`[SOURCE-START] ${source.source_name} targets=${urls.length} maxPages=${st.pages}`);
  while(q.length&&pages<st.pages){
    if(Date.now()-started>=CFG.sourceBudgetMs){
      warnings++;
      state.warnings++;
      console.log(`[SOURCE-TIMEOUT] ${source.source_name} budget=${CFG.sourceBudgetMs}ms pages=${pages}`);
      break;
    }
    q.sort((a,b)=>(b.isRoot-a.isRoot)||(linkRank({text:b.title,url:b.url})-linkRank({text:a.title,url:a.url}))||(a.depth-b.depth));
    const r=q.shift();if(seen.has(r.url))continue;seen.add(r.url);
    try{
      const got=await fetchUrl(r.url,r.isRoot?CFG.sourceTimeout:CFG.pageTimeout,`${source.source_name} ${r.url}`);
      pages++;state.pages++;
      const type=pdf(r.url)||/pdf/i.test(got.type)?"PDF":"HTML";
      let title="",text="",links=[];
      if(type==="PDF"){text=await extractPdf(got.buffer,got.url);title=decodeURIComponent(got.url.split("/").pop()||"PDF");}
      else {const p=parseHtml(got.buffer.toString("utf8"),got.url);title=p.title||r.title;text=p.text;links=p.links;}
      if(text){
        const matchedNow=termsIn(title+" "+got.url+" "+text);
        if(matchedNow.length) console.log(`[EVIDENCE] ${source.source_name} type=${type} terms=${matchedNow.join("|")} title=${trunc(title,180)} url=${got.url}`);
        await candidate({sourceId:source.id,runId:run.id,sourceName:source.source_name,organization:source.organization,url:got.url,title,text,documentType:type,status:"Official Source",discoveryMethod:type==="PDF"?"official-targeted-pdf":"official-targeted-page",verificationUrl:got.url}).then(x=>{if(x)state.candidates++;});
      }
      if(type==="HTML"&&r.depth<st.depth){
        for(const l of links.filter(crawlable).sort((a,b)=>linkRank(b)-linkRank(a)).slice(0,CFG.maxLinksPerPage)){
          if(/\.pdf(?:$|[?#])|\/(?:uploads?|documents?|download(?:s)?)\//i.test(l.url)) console.log(`[DOC-QUEUE] ${source.source_name} depth=${r.depth+1} title=${trunc(l.text,120)} url=${l.url}`);
          push(l.url,l.text,r.depth+1,false);
        }
      }
    }catch(e){if(r.isRoot){errors++;state.errors++;}else{warnings++;state.warnings++;}}
  }
  try{await patch(`source_registry?id=eq.${encodeURIComponent(source.id)}`,{last_checked:new Date().toISOString(),last_status:errors?"Error":warnings?"OK with warnings":"OK",last_error:errors?`root access failure(s): ${errors}`:null},`source health ${source.source_name}`)}catch{}
  console.log(`[SOURCE] ${source.source_name} pages=${pages} candidates=${state.candidates} errors=${errors} warnings=${warnings}`);
}

async function processAggregator(agg,run,state){
  try{
    const got=await fetchUrl(agg.url,CFG.sourceTimeout,agg.name);
    const p=parseHtml(got.buffer.toString("utf8"),got.url);
    const links=p.links.filter(crawlable).sort((a,b)=>linkRank(b)-linkRank(a)).slice(0,40);
    for(const l of links){
      try{
        const g=await fetchUrl(l.url,CFG.pageTimeout,agg.name);
        const type=pdf(l.url)||/pdf/i.test(g.type)?"PDF":"HTML";
        let title=l.text||"",text="",outLinks=[];
        if(type==="PDF"){text=await extractPdf(g.buffer,g.url);title=title||decodeURIComponent(g.url.split("/").pop()||"PDF");}
        else{const x=parseHtml(g.buffer.toString("utf8"),g.url);title=x.title||title;text=x.text;outLinks=x.links;}
        if(termsIn(`${title} ${g.url} ${text}`).length){
          const official=outLinks.find(x=>/\.gov\.in$|\.nic\.in$|\.ac\.in$|\.edu\.in$|\.org\.in$/i.test(host(x.url))&&!/result|answer|admit|corrigendum|cancel/i.test(x.text+" "+x.url));
          await candidate({sourceId:null,runId:run.id,sourceName:agg.name,organization:host(official?.url||g.url),url:official?.url||g.url,title,text,documentType:type,status:"Aggregator Discovery — Official verification required",discoveryMethod:"aggregator-discovery",verificationUrl:official?.url||""}).then(x=>{if(x)state.candidates++;});
        }
      }catch{}
    }
  }catch(e){state.warnings++;console.log("[AGGREGATOR]",agg.name,e.message);}
}

async function main(){
  console.log("FOUNDRYMAN VACANCY MONITOR V11.0 — TARGETED DISCOVERY");
  let sources=await get("source_registry?active=eq.true&select=*&order=priority.asc","load sources");
  if(!Array.isArray(sources))throw new Error("source registry not array");
  if(SOURCE_NAMES.length)sources=sources.filter(s=>SOURCE_NAMES.some(n=>(s.source_name||"").toLowerCase().includes(n)));
  if(SOURCE_OFFSET>0)sources=sources.slice(SOURCE_OFFSET);
  if(SOURCE_LIMIT>0)sources=sources.slice(0,SOURCE_LIMIT);
  if(MODE==="official-test")sources=sources.slice(0,Math.min(sources.length,SOURCE_LIMIT||8));
  const run0=await post("monitoring_runs",{started_at:new Date().toISOString(),status:"Running",sources_checked:0,pages_scanned:0,candidates_found:0,errors_count:0,notes:`V11.0 targeted discovery mode=${MODE}`},"create run");
  const run=Array.isArray(run0)?run0[0]:run0;const state={pages:0,candidates:0,errors:0,warnings:0};
  let idx=0;async function worker(){while(true){const i=idx++;if(i>=sources.length)return;await processSource(sources[i],run,state);}}
  await Promise.all(Array.from({length:Math.min(CFG.concurrency,sources.length)},worker));
  if(MODE!=="official-only"){for(const a of CFG.aggregators)await processAggregator(a,run,state);}
  await patch(`monitoring_runs?id=eq.${encodeURIComponent(run.id)}`,{finished_at:new Date().toISOString(),status:"Completed",sources_checked:sources.length,pages_scanned:state.pages,candidates_found:state.candidates,errors_count:state.errors,notes:`V11.0 mode=${MODE}; pages=${state.pages}; candidates=${state.candidates}; errors=${state.errors}; warnings=${state.warnings}`}, "finish run");
  console.log(JSON.stringify({checked:sources.length,pages:state.pages,candidates:state.candidates,errors:state.errors,warnings:state.warnings,mode:MODE}));
}
main().catch(e=>{console.error("[FATAL]",e);process.exit(1);});
