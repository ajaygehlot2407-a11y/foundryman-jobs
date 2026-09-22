'use client'

import { useEffect, useMemo, useState } from 'react'
import { getSupabase } from '../lib/supabase'

const fallback = [
  { vacancy_id:'FM-2026-001', organization:'CSIR-CMERI', post:'Technician-I (Group-II) - Foundryman', state:'West Bengal', location:'Durgapur', job_type:'Permanent', status:'Closed', verification_status:'Verified - Official Doc', eligibility:'ITI Foundryman', last_date:'2026-09-13', vacancy_count:null, official_notification_url:'https://www.cmeri.res.in/hi/vacancy', official_apply_url:null, foundryman_eligibility_evidence:'Official CSIR-CMERI vacancy page lists Technician-I recruitment and Foundryman trade eligibility.' },
  { vacancy_id:'FM-2026-002', organization:'DRDO-DRDL', post:'ITI Apprentice - Foundryman', state:'Telangana', location:'DRDL, Hyderabad', job_type:'Apprenticeship', status:'Closed', verification_status:'Verified - Official Doc', eligibility:'ITI Foundryman', last_date:'2026-01-29', vacancy_count:null, official_notification_url:'https://www.drdo.gov.in/drdo/sites/default/files/vacancy/advtDRDL15012026.pdf', official_apply_url:'https://www.apprenticeshipindia.gov.in/', foundryman_eligibility_evidence:'Official DRDL notification explicitly lists Foundryman among ITI apprentice trades.' },
  { vacancy_id:'FM-2026-003', organization:'West Central Railway', post:'Blacksmith (Foundryman) Apprentice', state:'Madhya Pradesh', location:'Jabalpur / Bhopal / Kota', job_type:'Apprenticeship', status:'Closed', verification_status:'Verified - Official Doc', eligibility:'Foundryman / Blacksmith (Foundryman)', last_date:null, vacancy_count:139, official_notification_url:'https://wcr.indianrailways.gov.in/', official_apply_url:null, foundryman_eligibility_evidence:'Official WCR notification explicitly lists Blacksmith (Foundryman).'},
  { vacancy_id:'FM-2026-004', organization:'BHEL Haridwar', post:'Artisan - Foundryman', state:'Uttarakhand', location:'Haridwar', job_type:'Permanent', status:'Closed', verification_status:'Verified - Official Doc', eligibility:'ITI Foundryman', last_date:null, vacancy_count:null, official_notification_url:'https://hwr.bhel.com/recruitment/', official_apply_url:null, foundryman_eligibility_evidence:'BHEL Haridwar recruitment records identify Foundryman trade.' },
  { vacancy_id:'FM-2026-005', organization:'UPSC / DGT', post:'Training Officer - Foundryman/Moulder', state:'All India', location:'DGT / All India service liability', job_type:'Permanent', status:'Closed', verification_status:'Verified - Official Doc', eligibility:'Foundryman / Moulder', last_date:null, vacancy_count:1, official_notification_url:'https://upsc.gov.in/recruitment', official_apply_url:null, foundryman_eligibility_evidence:'UPSC advertisement identifies Training Officer vacancy for Foundryman/Moulder under DGT.' }
]

function daysLeft(date) {
  if (!date) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(date + 'T00:00:00')
  return Math.ceil((d - today) / 86400000)
}

export default function Home() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [state, setState] = useState('All')
  const [jobType, setJobType] = useState('All')
  const [showClosed, setShowClosed] = useState(true)

  useEffect(() => {
    async function load() {
      const sb = getSupabase()
      if (!sb) { setRows(fallback); setLoading(false); return }
      const { data, error } = await sb.from('vacancy_dashboard').select('*').order('last_date', { ascending:true, nullsFirst:false })
      if (error || !data?.length) setRows(fallback)
      else setRows(data)
      setLoading(false)
    }
    load()
  }, [])

  const states = useMemo(() => ['All', ...Array.from(new Set(rows.map(x => x.state).filter(Boolean))).sort()], [rows])
  const types = useMemo(() => ['All', ...Array.from(new Set(rows.map(x => x.job_type).filter(Boolean))).sort()], [rows])

  const filtered = useMemo(() => rows.filter(v => {
    const hay = `${v.organization||''} ${v.post||''} ${v.state||''} ${v.location||''} ${v.eligibility||''}`.toLowerCase()
    const matchQ = !q || hay.includes(q.toLowerCase())
    const matchState = state === 'All' || v.state === state
    const matchType = jobType === 'All' || v.job_type === jobType
    const live = v.live_status || v.status
    const matchClosed = showClosed || live !== 'Closed'
    return matchQ && matchState && matchType && matchClosed
  }), [rows,q,state,jobType,showClosed])

  const openCount = rows.filter(v => (v.live_status || v.status) === 'Open').length
  const urgent = rows.filter(v => v.is_urgent || (daysLeft(v.last_date) != null && daysLeft(v.last_date) >= 0 && daysLeft(v.last_date) <= 7)).length
  const verified = rows.filter(v => String(v.verification_status||'').startsWith('Verified')).length

  return <main>
    <header className="topbar">
      <div className="brand"><span className="brandMark">F</span><div><strong>Foundryman Jobs India</strong><small>ITI Foundryman Vacancy Intelligence</small></div></div>
      <nav><a href="#dashboard">Dashboard</a><a href="#vacancies">Vacancies</a><a href="#sources">Sources</a></nav>
    </header>

    <section className="hero" id="dashboard">
      <div>
        <span className="eyebrow">🇮🇳 INDIA-WIDE JOB MONITOR</span>
        <h1>Foundryman jobs, apprenticeships &amp; technical vacancies.</h1>
        <p>एक जगह पर ITI Foundryman से जुड़ी verified vacancies, deadlines और official application links.</p>
        <div className="heroActions"><a className="primary" href="#vacancies">View vacancies</a><a className="secondary" href="#how">How verification works</a></div>
      </div>
      <div className="heroCard"><div className="pulse"></div><b>Verification-first database</b><span>Official notification evidence is stored with each vacancy.</span></div>
    </section>

    <section className="stats">
      <Stat label="Total vacancies" value={rows.length}/><Stat label="Open now" value={openCount}/><Stat label="Deadline ≤ 7 days" value={urgent}/><Stat label="Officially verified" value={verified}/>
    </section>

    <section className="panel" id="vacancies">
      <div className="sectionHead"><div><span className="eyebrow">LIVE DATABASE</span><h2>Vacancy directory</h2></div><span className="count">{filtered.length} results</span></div>
      <div className="filters">
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search Foundryman, railway, BHEL, DRDO…" />
        <select value={state} onChange={e=>setState(e.target.value)}>{states.map(s=><option key={s}>{s}</option>)}</select>
        <select value={jobType} onChange={e=>setJobType(e.target.value)}>{types.map(s=><option key={s}>{s}</option>)}</select>
        <label className="toggle"><input type="checkbox" checked={showClosed} onChange={e=>setShowClosed(e.target.checked)}/><span>Show closed</span></label>
      </div>

      {loading ? <div className="empty">Loading database…</div> : <div className="grid">{filtered.map(v => <VacancyCard key={v.vacancy_id} v={v}/>)}</div>}
      {!loading && !filtered.length && <div className="empty">No vacancy matches your filters.</div>}
    </section>

    <section className="how" id="how">
      <div><span className="eyebrow">RULES</span><h2>Foundryman eligibility is verified from the official notification.</h2></div>
      <div className="rules"><div><b>01</b><span>Discovery</span><p>Search exact and discovery keywords across recruitment sources.</p></div><div><b>02</b><span>Verification</span><p>“Foundry”, “Moulder” or “Blacksmith” is not automatically treated as Foundryman.</p></div><div><b>03</b><span>Database</span><p>Store the official evidence, deadline and application links.</p></div></div>
    </section>

    <footer id="sources"><b>Foundryman Jobs India</b><span>Free-tier V1 • Supabase + Next.js • Built for India</span></footer>
  </main>
}

function Stat({label,value}) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div> }

function VacancyCard({v}) {
  const d = v.days_remaining ?? daysLeft(v.last_date)
  const live = v.live_status || (d !== null && d < 0 ? 'Closed' : v.status)
  return <article className="card">
    <div className="cardTop"><span className={`badge ${live==='Open'?'open':'closed'}`}>{live || 'Under Review'}</span><span className="id">{v.vacancy_id}</span></div>
    <h3>{v.post}</h3><div className="org">{v.organization}</div>
    <div className="meta"><span>📍 {v.location || v.state || 'India'}</span><span>🧰 {v.job_type || '—'}</span>{v.vacancy_count ? <span>👥 {v.vacancy_count}</span>:null}</div>
    <div className="elig"><b>Eligibility:</b> {v.eligibility || 'See official notification'}</div>
    <div className="deadline">{d !== null ? <><b>{d < 0 ? 'Expired' : d === 0 ? 'Due today' : `${d} days left`}</b><span>Last date: {v.last_date}</span></> : <><b>No date stored</b><span>Check official notification</span></>}</div>
    <div className="cardActions">{v.official_notification_url && <a href={v.official_notification_url} target="_blank" rel="noreferrer">Official notice ↗</a>}{v.official_apply_url && <a className="apply" href={v.official_apply_url} target="_blank" rel="noreferrer">Apply ↗</a>}</div>
  </article>
}
