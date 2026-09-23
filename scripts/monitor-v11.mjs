import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) process.exit(1);

const REST = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1`;
const MODE = (process.env.MONITOR_MODE || "full").toLowerCase();
const SOURCE_LIMIT = Number(process.env.SOURCE_LIMIT || 0);
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
const host = u => { try{return new URL(u).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""} };
const pdf = u => /\.pdf(?:$|[?#])/i.test(u);
const normalize = (u,b) => { try{return new URL(u,b).href.split("#")[0]}catch{return null} };

function termsIn(text, terms=CFG.foundry) {
  const l=clean(text).toLowerCase();
  return terms.filter(t=>l.includes(t));
}
function score(title,url,text) {
  const a=(clean(title)+" "+url+" "+clean(text)).toLowerCase();
  let s=0;
  for(const t of CFG.strong) if(a.includes(t)) s+=35;
  if(a.includes("foundry")) s+=20;
  if(CFG.recruitment.some(t=>a.includes(t))) s+=15;
  if(/\b(iti|ncvt|scvt|ntc|nac|apprentice)\b/i.test(a)) s+=15;
  if(pdf(url)) s+=5;
  return Math.min(100,s);
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
function fingerprint(sourceId,url,title){return crypto.createHash("sha256").update(`${sourceId||"agg"}|${url.toLowerCase()}|${clean(title).toLowerCase()}`).digest("hex");}

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
  let last;
  try{
    const c=new AbortController(), t=setTimeout(()=>c.abort(),timeout);
    const r=await fetch(url,{redirect:"follow",signal:c.signal,headers:{
      "User-Agent":CFG.userAgent,Accept:"text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8","Accept-Language":"en-IN,en;q=0.9"
    }});
    clearTimeout(t);
    const b=Buffer.from(await r.arrayBuffer());
    if(r.ok&&b.length)return {status:r.status,type:r.headers.get("content-type")||"",url:r.url||url,buffer:b};
    last=new Error(`HTTP ${r.status}`);
  }catch(e){last=e;}
  if(String(last?.message||"").toLowerCase().includes("abort")) throw last;
  const args=["-L","--compressed","--silent","--show-error","--connect-timeout","8","--max-time",String(CFG.curlTimeout),"-A",CFG.userAgent,"-H","Accept: text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8","-w","\n__STATUS__:%{http_code}\n__TYPE__:%{content_type}\n__URL__:%{url_effective}\n",url];
  const r=await new Promise((resolve,reject)=>{
    const p=spawn("curl",args),o=[],e=[];p.stdout.on("data",d=>o.push(d));p.stderr.on("data",d=>e.push(d));
    p.on("error",reject);p.on("close",code=>{const s=Buffer.concat(o).toString(),err=Buffer.concat(e).toString();const m=s.match(/\n__STATUS__:(\d+)/),tm=s.match(/\n__TYPE__:(.*?)\s*$/m),um=s.match(/\n__URL__:(.*?)\s*$/m);let end=s.length;for(const x of ["\n__STATUS__:","\n__TYPE__:","\n__URL__:"]){const i=s.indexOf(x);if(i>=0)end=Math.min(end,i);}const body=Buffer.from(s.slice(0,end));const status=m?+m[1]:0;if(code!==0&&body.length===0)return reject(new Error(`curl exit ${code}: ${trunc(err,300)}`));resolve({status,type:tm?tm[1].trim():"",url:um?um[1].trim():url,buffer:body});});
  });
  if(r.status>=200&&r.status<400&&r.buffer.length)return r;
  throw new Error(`HTTP ${r.status||"unknown"}`);
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
  const links=[];const re=/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;
  while((m=re.exec(raw))&&links.length<CFG.maxLinksPerPage){const u=normalize(m[1],base);if(http(u))links.push({url:u,text:clean(m[2].replace(/<[^>]+>/g," "))});}
  return {title,text,links};
}

function linkRank(l){
  const v=(clean(l.text)+" "+l.url).toLowerCase();let n=0;
  if(/foundryman|foundry[ -]?man|moulder|molder/.test(v))n+=100;
  if(/foundry|apprentice|vacancy|recruitment|notification|advertisement|iti/.test(v))n+=50;
  if(/\.pdf(?:$|[?#])|uploads|documents|download/.test(v))n+=35;
  if(/career|job|employment/.test(v))n+=15;
  return n;
}
function crawlable(l){
  const v=(clean(l.text)+" "+l.url).toLowerCase();
  if(CFG.exclude.some(x=>v.includes(x)))return false;
  return /foundry|moulder|molder|recruit|vacanc|career|job|apprentice|notification|advertisement|iti|\.pdf|uploads|documents|download/.test(v);
}

async function candidate({sourceId,runId,sourceName,url,title,text,documentType,status,discoveryMethod,verificationUrl}){
  const matched=termsIn(`${title} ${url} ${text}`);
  const sc=score(title,url,text);
  const recruit=CFG.recruitment.some(t=>clean(text).toLowerCase().includes(t)||clean(title).toLowerCase().includes(t));
  if(matched.length===0 || (sc<55&&!recruit))return false;
  const fp=fingerprint(sourceId,url,title);
  const row={
    source_id:sourceId||null,monitoring_run_id:runId,discovered_at:new Date().toISOString(),
    title:trunc(title,500)||sourceName||"Foundryman-related opportunity",url,
    matched_keywords:matched.join(", "),snippet:context(text)||trunc(text,1000),
    source_status:status,eligibility_status:"Needs Verification",review_status:"Pending Review",fingerprint:fp,
    document_type:documentType,matched_context:context(text),confidence_score:sc,
    deadline_text:deadline(text),qualification_text:qualification(text),document_title:trunc(title,500),
    content_hash:crypto.createHash("sha256").update(clean(text)).digest("hex"),
    discovery_method:discoveryMethod,verification_url:verificationUrl||url
  };
  try{await post("vacancy_candidates",row,`candidate ${sourceName}`);return true;}
  catch(e){if(String(e).includes("23505")||String(e).toLowerCase().includes("duplicate"))return false;console.log("[CANDIDATE-ERROR]",sourceName,e.message);return false;}
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
  const urls=[source.recruitment_url,source.official_url].filter((u,i,a)=>http(u)&&a.indexOf(u)===i);
  if(!urls.length){state.errors++;return;}
  const st=strategy(source), q=[],seen=new Set(),queued=new Set(),hosts=new Set(urls.map(host)); 
  const push=(url,title="",depth=0,isRoot=false)=>{if(!url||!http(url)||queued.has(url)||seen.has(url))return;const h=host(url);if(![...hosts].some(x=>h===x||h.endsWith("."+x)||x.endsWith("."+h)))return;queued.add(url);q.push({url,title,depth,isRoot});};
  urls.forEach(u=>push(u,"Recruitment",0,true));
  let pages=0,errors=0,warnings=0;
  while(q.length&&pages<st.pages){
    q.sort((a,b)=>(b.isRoot-a.isRoot)||(b.depth-a.depth?0:linkRank({text:b.title,url:b.url})-linkRank({text:a.title,url:a.url})));
    const r=q.shift();if(seen.has(r.url))continue;seen.add(r.url);
    try{
      const got=await fetchUrl(r.url,r.isRoot?CFG.sourceTimeout:CFG.pageTimeout,`${source.source_name} ${r.url}`);
      pages++;state.pages++;
      const type=pdf(r.url)||/pdf/i.test(got.type)?"PDF":"HTML";
      let title="",text="",links=[];
      if(type==="PDF"){text=await extractPdf(got.buffer,got.url);title=decodeURIComponent(got.url.split("/").pop()||"PDF");}
      else {const p=parseHtml(got.buffer.toString("utf8"),got.url);title=p.title||r.title;text=p.text;links=p.links;}
      if(text)await candidate({sourceId:source.id,runId:run.id,sourceName:source.source_name,url:got.url,title,text,documentType:type,status:"Official Source",discoveryMethod:type==="PDF"?"official-targeted-pdf":"official-targeted-page",verificationUrl:got.url}).then(x=>{if(x)state.candidates++;});
      if(type==="HTML"&&r.depth<st.depth){
        for(const l of links.filter(crawlable).sort((a,b)=>linkRank(b)-linkRank(a)).slice(0,CFG.maxLinksPerPage))push(l.url,l.text,r.depth+1,false);
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
          const official=outLinks.find(x=>/\.gov\.in$|\.nic\.in$|\.ac\.in$|\.edu\.in$|\.org\.in$/i.test(host(x.url)));
          await candidate({sourceId:null,runId:run.id,sourceName:agg.name,url:g.url,title,text,documentType:type,status:"Aggregator Discovery — Official verification required",discoveryMethod:"aggregator-discovery",verificationUrl:official?.url||""}).then(x=>{if(x)state.candidates++;});
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
