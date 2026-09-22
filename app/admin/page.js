'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '../../lib/supabase'

const emptyForm = {
  vacancy_id: '', organization: '', department: '', post: '', recruitment: '', notification_number: '',
  vacancy_count: '', state: '', location: '', job_type: 'Permanent', eligibility: 'ITI Foundryman',
  qualification: '', age_limit: '', salary_stipend: '', application_start: '', last_date: '',
  selection_process: '', official_notification_url: '', official_apply_url: '', source_website: '',
  source_type: 'Govt Official Site', verification_status: 'Pending', foundryman_eligibility_evidence: '',
  urgency_level: 'Low', eligibility_compliance: 'Ambiguous', status: 'Open', notes: ''
}

export default function AdminPage() {
  const sb = useMemo(() => getSupabase(), [])
  const [session, setSession] = useState(null), [checking, setChecking] = useState(true), [authorized, setAuthorized] = useState(false)
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [rows, setRows] = useState([])
  const [form, setForm] = useState(emptyForm), [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')

  useEffect(() => {
    if (!sb) { setChecking(false); return }
    let active = true
    ;(async () => {
      const { data: { session } } = await sb.auth.getSession()
      if (!active) return
      setSession(session)
      if (session?.user) await checkAdmin(session.user)
      setChecking(false)
    })()
    const { data: listener } = sb.auth.onAuthStateChange(async (_event, next) => {
      setSession(next)
      if (next?.user) await checkAdmin(next.user)
      else setAuthorized(false)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [sb])

  async function checkAdmin(user) {
    setError('')
    const { data, error } = await sb.from('admin_users').select('user_id, email, active').eq('user_id', user.id).eq('active', true).maybeSingle()
    if (error) { setAuthorized(false); setError(error.message); return }
    setAuthorized(!!data)
    if (data) await loadRows()
  }
  async function loadRows() {
    const { data, error } = await sb.from('vacancies').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message); else setRows(data || [])
  }
  async function login(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('')
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error) setError(error.message); else if (data.user) await checkAdmin(data.user)
    setBusy(false)
  }
  async function logout() { await sb.auth.signOut(); setAuthorized(false); setRows([]); setForm(emptyForm); setEditingId(null) }
  function change(e) { const { name, value } = e.target; setForm(f => ({ ...f, [name]: value })) }
  function edit(row) {
    setEditingId(row.id)
    const next = { ...emptyForm }
    Object.keys(next).forEach(k => { next[k] = row[k] ?? '' })
    setForm(next); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function resetForm() { setEditingId(null); setForm(emptyForm); setMessage('') }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('')
    const payload = { ...form }
    payload.vacancy_count = payload.vacancy_count === '' ? null : Number(payload.vacancy_count)
    payload.application_start = payload.application_start || null; payload.last_date = payload.last_date || null
    Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null })
    const result = editingId ? await sb.from('vacancies').update(payload).eq('id', editingId) : await sb.from('vacancies').insert(payload)
    if (result.error) setError(result.error.message)
    else { setMessage(editingId ? 'Vacancy updated.' : 'Vacancy added.'); resetForm(); await loadRows() }
    setBusy(false)
  }
  async function remove(row) {
    if (!confirm(`Delete ${row.post}? This cannot be undone.`)) return
    setBusy(true); setError('')
    const { error } = await sb.from('vacancies').delete().eq('id', row.id)
    if (error) setError(error.message); else { setMessage('Vacancy deleted.'); await loadRows() }
    setBusy(false)
  }

  if (checking) return <main><Header/><div className="adminShell"><div className="empty">Checking admin session…</div></div></main>
  if (!sb) return <main><Header/><div className="adminShell"><div className="empty">Supabase environment variables are missing.</div></div></main>
  if (!session) return <main><Header/><Login email={email} password={password} setEmail={setEmail} setPassword={setPassword} onSubmit={login} busy={busy} error={error}/></main>
  if (!authorized) return <main><Header/><div className="adminShell narrow"><div className="adminCard"><span className="eyebrow">ADMIN ACCESS</span><h1>Not authorized</h1><p>Your signed-in account is not registered in <code>admin_users</code>.</p>{error && <div className="errorBox">{error}</div>}<button className="secondaryBtn" onClick={logout}>Sign out</button></div></div></main>

  return <main><Header admin/><div className="adminShell">
    <div className="adminTop"><div><span className="eyebrow">ADMIN PANEL</span><h1>Manage vacancies</h1><p>Add, edit, verify and close Foundryman vacancy records.</p></div><button className="secondaryBtn" onClick={logout}>Sign out</button></div>
    {message && <div className="successBox">{message}</div>}{error && <div className="errorBox">{error}</div>}
    <form className="adminCard adminForm" onSubmit={save}>
      <div className="formHead"><div><h2>{editingId ? 'Edit vacancy' : 'Add vacancy'}</h2><p>Record official eligibility evidence before marking a vacancy verified.</p></div>{editingId && <button type="button" className="secondaryBtn" onClick={resetForm}>Cancel edit</button>}</div>
      <div className="formGrid">
        <Field name="vacancy_id" label="Vacancy ID" value={form.vacancy_id} onChange={change} required placeholder="FM-2026-006"/><Field name="organization" label="Organization" value={form.organization} onChange={change} required/><Field name="post" label="Post" value={form.post} onChange={change} required/><Field name="department" label="Department" value={form.department} onChange={change}/><Field name="recruitment" label="Recruitment" value={form.recruitment} onChange={change}/><Field name="notification_number" label="Notification number" value={form.notification_number} onChange={change}/><Field name="vacancy_count" label="Vacancy count" type="number" value={form.vacancy_count} onChange={change}/><Field name="state" label="State / coverage" value={form.state} onChange={change}/><Field name="location" label="Location" value={form.location} onChange={change}/><Select name="job_type" label="Job type" value={form.job_type} onChange={change} options={['Permanent','Contract','Apprenticeship','Temporary','Other','Full-Time']}/><Select name="status" label="Status" value={form.status} onChange={change} options={['Open','Closed','Under Review','Withdrawn','Rejected']}/><Select name="verification_status" label="Verification" value={form.verification_status} onChange={change} options={['Verified - Official Doc','Verified','Pending','Unverified','Not Foundryman Eligible']}/><Select name="eligibility_compliance" label="Eligibility compliance" value={form.eligibility_compliance} onChange={change} options={['Officially Eligible','Ambiguous','Not Eligible','Meets']}/><Select name="urgency_level" label="Urgency" value={form.urgency_level} onChange={change} options={['High','Medium','Low']}/><Field name="eligibility" label="Eligibility" value={form.eligibility} onChange={change}/><Field name="qualification" label="Qualification" value={form.qualification} onChange={change}/><Field name="age_limit" label="Age limit" value={form.age_limit} onChange={change}/><Field name="salary_stipend" label="Salary / stipend" value={form.salary_stipend} onChange={change}/><Field name="application_start" label="Application start" type="date" value={form.application_start} onChange={change}/><Field name="last_date" label="Last date" type="date" value={form.last_date} onChange={change}/><Field name="official_notification_url" label="Official notification URL" value={form.official_notification_url} onChange={change} className="span2"/><Field name="official_apply_url" label="Official apply URL" value={form.official_apply_url} onChange={change} className="span2"/><Field name="source_website" label="Source website" value={form.source_website} onChange={change}/><Field name="source_type" label="Source type" value={form.source_type} onChange={change}/><TextArea name="foundryman_eligibility_evidence" label="Foundryman eligibility evidence" value={form.foundryman_eligibility_evidence} onChange={change} className="span2"/><TextArea name="selection_process" label="Selection process" value={form.selection_process} onChange={change}/><TextArea name="notes" label="Notes" value={form.notes} onChange={change}/>
      </div>
      <div className="formActions"><button className="primaryBtn" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Update vacancy' : 'Add vacancy'}</button></div>
    </form>
    <section className="adminCard"><div className="formHead"><div><h2>Existing vacancies</h2><p>{rows.length} records in the database.</p></div></div><div className="adminTableWrap"><table><thead><tr><th>Post</th><th>Organization</th><th>Status</th><th>Verification</th><th>Last date</th><th>Actions</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.post}</b><small>{r.vacancy_id}</small></td><td>{r.organization}</td><td>{r.status}</td><td>{r.verification_status}</td><td>{r.last_date||'—'}</td><td><div className="tableActions"><button onClick={()=>edit(r)}>Edit</button><button className="dangerBtn" onClick={()=>remove(r)}>Delete</button></div></td></tr>)}</tbody></table></div></section>
  </div></main>
}
function Login({email,password,setEmail,setPassword,onSubmit,busy,error}) { return <div className="adminShell narrow"><div className="adminCard loginCard"><span className="eyebrow">PRIVATE AREA</span><h1>Admin sign in</h1><p>Only authorized administrators can change vacancy data.</p>{error&&<div className="errorBox">{error}</div>}<form onSubmit={onSubmit}><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label><button className="primaryBtn wideBtn" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><p className="adminHint">Create the admin user in Supabase Authentication first, then add that user's UUID to the <code>admin_users</code> table.</p></div></div> }
function Field({name,label,value,onChange,type='text',required=false,placeholder='',className=''}) { return <label className={className}>{label}<input name={name} type={type} value={value??''} onChange={onChange} required={required} placeholder={placeholder}/></label> }
function TextArea({name,label,value,onChange,className=''}) { return <label className={className}>{label}<textarea name={name} value={value??''} onChange={onChange} rows="4"/></label> }
function Select({name,label,value,onChange,options}) { return <label>{label}<select name={name} value={value??''} onChange={onChange}>{options.map(o=><option key={o}>{o}</option>)}</select> }
function Header({admin=false}){return <header className="topbar"><Link href="/" className="brand"><span className="brandMark">F</span><span><strong>Foundryman Jobs India</strong><small>ITI Foundryman Vacancy Intelligence</small></span></Link><nav><Link href="/">Dashboard</Link><Link href="/vacancies">Vacancies</Link><Link href="/sources">Sources</Link><Link href="/admin" className={admin?'navAdmin':''}>Admin</Link></nav></header>}
