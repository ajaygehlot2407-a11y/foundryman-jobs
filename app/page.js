'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '../lib/supabase'

const fallback = [
  { vacancy_id:'FM-2026-001', organization:'CSIR-CMERI', post:'Technician-I (Group-II) - Foundryman', state:'West Bengal', location:'Durgapur', job_type:'Permanent', status:'Closed', live_status:'Closed', verification_status:'Verified - Official Doc', eligibility:'ITI Foundryman', last_date:'2026-09-13', vacancy_count:null },
  { vacancy_id:'FM-2026-002', organization:'DRDO-DRDL', post:'ITI Apprentice - Foundryman', state:'Telangana', location:'DRDL, Hyderabad', job_type:'Apprenticeship', status:'Closed', live_status:'Closed', verification_status:'Verified - Official Doc', eligibility:'ITI Foundryman', last_date:'2026-01-29', vacancy_count:null },
  { vacancy_id:'FM-2026-003', organization:'West Central Railway', post:'Blacksmith (Foundryman) Apprentice', state:'Madhya Pradesh', location:'Jabalpur / Bhopal / Kota', job_type:'Apprenticeship', status:'Closed', live_status:'Closed', verification_status:'Verified - Official Doc', eligibility:'Foundryman / Blacksmith (Foundryman)', last_date:null, vacancy_count:139 },
  { vacancy_id:'FM-2026-004', organization:'BHEL Haridwar', post:'Artisan - Foundryman', state:'Uttarakhand', location:'Haridwar', job_type:'Permanent', status:'Closed', live_status:'Closed', verification_status:'Verified - Official Doc', eligibility:'ITI Foundryman', last_date:null, vacancy_count:null },
  { vacancy_id:'FM-2026-005', organization:'UPSC / DGT', post:'Training Officer - Foundryman/Moulder', state:'All India', location:'DGT / All India service liability', job_type:'Permanent', status:'Closed', live_status:'Closed', verification_status:'Verified - Official Doc', eligibility:'Foundryman / Moulder', last_date:null, vacancy_count:1 }
]

function daysLeft(date) {
  if (!date) return null
  const a = new Date(); a.setHours(0,0,0,0)
  const b = new Date(date + 'T00:00:00')
  return Math.ceil((b-a)/86400000)
}

export default function Home() {
  const [rows,setRows]=useState([])
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    async function load(){
      const sb=getSupabase()
      if(!sb){setRows(fallback);setLoading(false);return}
      const {data,error}=await sb.from('vacancy_dashboard').select('*').order('last_date',{ascending:true,nullsFirst:false})
      setRows(error||!data?.length?fallback:data)
      setLoading(false)
    }
    load()
  },[])
  const open=rows.filter(v=>(v.live_status||v.status)==='Open').length
  const urgent=rows.filter(v=>{
    const live=v.live_status||v.status
    const d=v.days_remaining??daysLeft(v.last_date)
    return live==='Open' && d!==null && d>=0 && d<=7
  }).length
  const verified=rows.filter(v=>String(v.verification_status||'').startsWith('Verified')).length
  const apprentices=rows.filter(v=>v.job_type==='Apprenticeship').length
  const rail=rows.filter(v=>/railway/i.test(v.organization||'')).length
  const defence=rows.filter(v=>/drdo|defence|defense|navy/i.test(v.organization||'')).length
  const psu=rows.filter(v=>/bhel|hal|psu/i.test(v.organization||'')).length
  const latest=rows.slice(0,4)
  return <main>
    <Header />
    <section className="heroV2">
      <div className="heroCopy">
        <span className="eyebrow">🇮🇳 INDIA-WIDE FOUNDRYMAN MONITOR</span>
        <h1>ITI Foundryman vacancies, tracked from official sources.</h1>
        <p>Verified recruitment, apprenticeship and technical opportunities — with deadlines, eligibility evidence and official application links in one place.</p>
        <div className="heroActions"><Link className="primary" href="/vacancies">Browse vacancies</Link><Link className="secondary" href="/sources">View monitored sources</Link></div>
        <div className="trustRow"><span>✓ Official-source first</span><span>✓ Foundryman eligibility evidence</span><span>✓ Free-tier infrastructure</span></div>
      </div>
      <div className="heroPanel">
        <div className="panelLabel">LIVE DATABASE</div>
        <div className="heroNumber">{loading?'—':rows.length}</div>
        <div className="heroCaption">vacancy records</div>
        <div className="miniStats"><span><b>{open}</b> open</span><span><b>{urgent}</b> urgent</span><span><b>{verified}</b> verified</span></div>
      </div>
    </section>

    <section className="statsV2">
      <Stat label="Open now" value={open} tone="green" />
      <Stat label="Deadline ≤ 7 days" value={urgent} tone="amber" />
      <Stat label="Apprenticeships" value={apprentices} />
      <Stat label="Officially verified" value={verified} tone="green" />
    </section>

    <section className="quickSection">
      <div className="sectionHead"><div><span className="eyebrow">EXPLORE</span><h2>Find the category you need</h2></div><Link href="/vacancies">All vacancies →</Link></div>
      <div className="quickGrid">
        <Quick title="Railway" value={rail} icon="🚂" href="/vacancies?organization=Railway" />
        <Quick title="Defence / DRDO" value={defence} icon="🛡️" href="/vacancies?organization=DRDO" />
        <Quick title="PSU" value={psu} icon="🏭" href="/vacancies?organization=PSU" />
        <Quick title="Apprenticeship" value={apprentices} icon="🎓" href="/vacancies?jobType=Apprenticeship" />
      </div>
    </section>

    <section className="latestSection">
      <div className="sectionHead"><div><span className="eyebrow">LATEST RECORDS</span><h2>Recently tracked vacancies</h2></div><Link href="/vacancies">Open directory →</Link></div>
      {loading?<div className="empty">Loading live database…</div>:<div className="tableWrap"><table><thead><tr><th>Post</th><th>Organization</th><th>Location</th><th>Deadline</th><th>Status</th></tr></thead><tbody>{latest.map(v=><tr key={v.vacancy_id}><td><Link href={`/vacancies/${v.vacancy_id}`} className="postLink">{v.post}</Link><small>{v.vacancy_id}</small></td><td>{v.organization}</td><td>{v.location||v.state||'India'}</td><td>{v.last_date||'—'}</td><td><Status v={v}/></td></tr>)}</tbody></table></div>}
    </section>

    <section className="howV2"><div><span className="eyebrow">VERIFICATION STANDARD</span><h2>Search broadly. Publish carefully.</h2><p>Discovery keywords can find leads, but a vacancy is only treated as Foundryman-eligible when the official recruitment material supports it.</p><Link className="secondary" href="/sources">See source registry</Link></div><div className="steps"><Step n="01" title="Discover" text="Monitor official recruitment pages and relevant discovery keywords."/><Step n="02" title="Verify" text="Check the notification for Foundryman eligibility or explicit equivalence."/><Step n="03" title="Publish" text="Store the official evidence, deadline and application links."/></div></section>
    <Footer />
  </main>
}

function Header(){return <header className="topbar"><Link href="/" className="brand"><span className="brandMark">F</span><span><strong>Foundryman Jobs India</strong><small>ITI Foundryman Vacancy Intelligence</small></span></Link><nav><Link href="/">Dashboard</Link><Link href="/vacancies">Vacancies</Link><Link href="/sources">Sources</Link></nav></header>}
function Footer(){return <footer><b>Foundryman Jobs India</b><span>Verification-first • Supabase + Next.js + Vercel</span></footer>}
function Stat({label,value,tone}){return <div className={`statV2 ${tone||''}`}><span>{label}</span><strong>{value}</strong></div>}
function Quick({title,value,icon,href}){return <Link className="quickCard" href={href}><span className="quickIcon">{icon}</span><span><b>{title}</b><small>{value} tracked</small></span><span className="arrow">→</span></Link>}
function Status({v}){const d=v.days_remaining??daysLeft(v.last_date);const live=v.live_status||(d!==null&&d<0?'Closed':v.status);return <span className={`status ${live==='Open'?'open':'closed'}`}>{live}</span>}
function Step({n,title,text}){return <div className="step"><b>{n}</b><div><strong>{title}</strong><p>{text}</p></div></div>}
