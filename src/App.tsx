import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, CarFront, Check, ChevronRight, Clock3, CreditCard, LayoutGrid, Leaf, LogOut, MapPin, ParkingSquare, Plus, Radio, ShieldCheck, X } from 'lucide-react'
import { api as defaultApi, configured, type ParkingApi } from './api'
import { canEdit, counts, layoutLabels, validateDraft, type Lot, type LotDraft, type Occupancy, type Profile, type Role, type Slot } from './domain'
import { useParking } from './useParking'

const message = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Please try again.'
export function App({ api = defaultApi }: { api?: ParkingApi }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [booting, setBooting] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'parking' | 'pay'>('parking')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const parking = useParking(api, profile?.id)
  useEffect(() => {
    let active = true
    let version = 0
    const accept = async (next: Session | null) => {
      const current = ++version
      if (!active) return
      setSession(next); setProfile(null); setError(''); setSelected(null); setTab('parking'); setCreating(false)
      try {
        if (next) {
          const value = await api.profile(next.user.id)
          if (active && current === version) setProfile(value)
        }
      } catch (e) {
        if (active && current === version) setError(message(e))
      } finally {
        if (active && current === version) setBooting(false)
      }
    }
    if (api === defaultApi && !configured) { setBooting(false); return }
    // Defer profile queries out of Supabase's auth event callback.
    const unsubscribe = api.onAuth((next) => { queueMicrotask(() => { void accept(next) }) })
    const initialVersion = version
    void api.session().then((next) => {
      if (version === initialVersion) return accept(next)
    }).catch((e) => { if (active) { setError(message(e)); setBooting(false) } })
    return () => { active = false; version++; unsubscribe() }
  }, [api])
  const visibleLots = parking.data.lots.filter((item) => profile?.role === 'owner' ? item.owner_id === profile.id : item.published)
  const lot = visibleLots.find((item) => item.id === selected)
  async function signOut() {
    try { await api.signOut() } catch (e) { setError(message(e)) }
  }
  return <div className="app-shell">
    <header className="header">
      <a className="brand" href="/" aria-label="Khali Spot home"><span className="brand-icon"><ParkingSquare size={25} /></span><span>khali<span className="brand-accent">spot</span><small>PARKING, SIMPLIFIED</small></span></a>
      <div className="header-right"><span className="demo-tag"><Radio size={13} /> Manual demo</span>{profile && <><span className="account-role">{profile.role === 'owner' ? 'Lot owner' : 'Visitor'}</span><button className="icon-button" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={18} /></button></>}</div>
    </header>
    {booting ? <main className="loading">Getting your parking view ready...</main> : !session ? <Auth api={api} initialError={error} /> : !profile ? <main className="container"><div role="alert" className="notice error">{error || 'Loading account role...'}</div><button onClick={() => window.location.reload()}>Retry account loading</button><button onClick={() => void signOut()}>Sign out</button></main> :
      <main className="container">
        <nav className="tabs" aria-label="Main navigation"><button className={tab === 'parking' ? 'active' : ''} onClick={() => setTab('parking')}><LayoutGrid size={17} />{profile.role === 'owner' ? 'My parking lots' : 'Find parking'}</button>{profile.role === 'visitor' && <button className={tab === 'pay' ? 'active' : ''} onClick={() => setTab('pay')}><CreditCard size={17} />Pay & Park <span className="soon">Coming soon</span></button>}</nav>
        {error && <div className="notice error" role="alert">{error}</div>}
        {tab === 'pay' ? <section className="coming panel"><span className="large-icon"><CreditCard /></span><span className="eyebrow">A LITTLE FURTHER DOWN THE ROAD</span><h1>Park now. Pay later.</h1><p>Pay & Park is coming to Khali Spot. For now, explore parking lots and find an available space.</p><div className="notice">No payments or reservations are available. We do not collect payment details.</div><button className="primary" onClick={() => setTab('parking')}>Find parking <ArrowRight size={16} /></button></section> :
          <>
            <section className="page-heading"><div><span className="eyebrow">LESS CIRCLING. MORE LIVING.</span><h1>{profile.role === 'owner' ? 'Your lots. Your control.' : 'A good day starts with a spot.'}</h1><p>{profile.role === 'owner' ? 'Create your layout, publish it, and keep your parking lot moving.' : 'Explore parking at malls, offices, and more. See the latest available spaces.'}</p></div>{profile.role === 'owner' && <button className="primary" onClick={() => { setCreating(true); setSelected(null) }}><Plus size={18} />Create parking lot</button>}</section>
            <div className={`connection ${parking.stale ? 'disconnected' : ''}`} role="status"><span className="status-dot" />{parking.loading ? 'Connecting to parking data...' : parking.stale ? 'Not live - availability may be out of date' : 'Live updates connected'}<span className="connection-detail">{parking.syncedAt ? `Last synced ${new Date(parking.syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for first successful sync'}</span><button className="text-button" onClick={() => void parking.refresh()}>Refresh</button></div>
            {parking.error && <div className="notice error" role="alert">{parking.error} Check Supabase setup or your connection. No sample data is being substituted.</div>}
            {creating ? <LotForm onCancel={() => setCreating(false)} onSave={async (draft) => { const id = await api.createLot(draft); await parking.refresh(); setCreating(false); setSelected(id) }} /> :
              lot ? <LotDetail key={lot.id} lot={lot} slots={parking.data.slots.filter((s) => s.lot_id === lot.id)} profile={profile} stale={parking.stale} api={api} refresh={parking.refresh} onBack={() => setSelected(null)} /> :
                <><div className="section-title"><h2>{profile.role === 'owner' ? 'Your parking spaces' : 'Explore parking lots'}</h2><span>{visibleLots.length} {visibleLots.length === 1 ? 'lot' : 'lots'}</span></div>
                  <div className="lot-grid">{visibleLots.map((item) => <LotCard key={item.id} lot={item} slots={parking.data.slots.filter((s) => s.lot_id === item.id)} stale={parking.stale} onSelect={() => setSelected(item.id)} />)}</div>
                  {!parking.loading && !parking.error && visibleLots.length === 0 && <div className="empty panel"><ParkingSquare size={40} /><h2>{profile.role === 'owner' ? 'Your first lot starts here.' : 'No published lots just yet.'}</h2><p>{profile.role === 'owner' ? 'Turn rows and spaces into a parking map in seconds.' : 'Check back once a lot owner publishes a parking lot.'}</p>{profile.role === 'owner' && <button className="primary" onClick={() => setCreating(true)}><Plus size={17} />Create your first lot</button>}</div>}
                  <div className="demo-note"><ShieldCheck size={19} /><p><strong>Real layouts. Manual availability.</strong> This demo uses owner-marked spaces, not sensors. A free space is not a reservation or guarantee.</p></div></>}
          </>}
      </main>}
    <footer><span><Leaf size={14} /> Less searching. More living.</span><span>Made for every destination <span className="footer-dot">/</span> Khali Spot</span></footer>
  </div>
}
function Auth({ api, initialError }: { api: ParkingApi; initialError: string }) {
  const [signup, setSignup] = useState(false)
  const [role, setRole] = useState<Role>('visitor')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  const [info, setInfo] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setInfo(''); setBusy(true)
    try {
      if (signup) {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.')
        const active = await api.signUp(email.trim(), password, role)
        if (!active) setInfo('Check your email to confirm your account, then return here to sign in.')
      } else await api.signIn(email.trim(), password)
    } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  return <main className="auth-layout">
    <section className="auth-story"><span className="story-label"><span className="status-dot" /> SMARTER PARKING STARTS HERE</span><h1>Less time<br />finding parking.<br /><span>More time being you.</span></h1><p>From malls to offices and everywhere in between. Find available parking or give your lot a little more order.</p><div className="mini-map" aria-hidden="true"><div className="mini-road">PARKING LAYOUT</div><div className="mini-slots">{['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'].map((label, i) => <span key={label} className={[1, 3, 6, 7].includes(i) ? 'mini-occupied' : ''}>{[1, 3, 6, 7].includes(i) ? <CarFront size={25} /> : <Check size={17} />}<small>{label}</small></span>)}</div><div className="map-caption"><span className="status-dot" /> Illustrative layout <span>Manual demo</span></div></div><div className="story-bottom"><ShieldCheck size={18} /><span>Made for visitors and lot owners. Built to keep things simple.</span></div></section>
    <section className="auth-panel"><div className="auth-card"><span className="eyebrow">WELCOME TO KHALI SPOT</span><h2>{signup ? 'Find your place.' : 'Your spot is waiting.'}</h2><p>{signup ? 'One account. Simpler parking wherever you go.' : 'Sign in to find a space or manage your parking lot.'}</p><div className="auth-switch"><button className={!signup ? 'active' : ''} onClick={() => { setSignup(false); setError(''); setInfo('') }}>Sign in</button><button className={signup ? 'active' : ''} onClick={() => { setSignup(true); setError(''); setInfo('') }}>Create account</button></div>
      <form aria-label="Authentication" onSubmit={(e) => void submit(e)}>
        {signup && <fieldset className="role-picker"><legend>I am a...</legend><label className={role === 'visitor' ? 'chosen' : ''}><input type="radio" name="role" value="visitor" checked={role === 'visitor'} onChange={() => setRole('visitor')} /><CarFront size={20} /><strong>Visitor</strong><small>Find a parking space</small></label><label className={role === 'owner' ? 'chosen' : ''}><input type="radio" name="role" value="owner" checked={role === 'owner'} onChange={() => setRole('owner')} /><LayoutGrid size={20} /><strong>Lot owner</strong><small>Manage my own lots</small></label></fieldset>}
        <label>Email address<input type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'At least 8 characters' : 'Enter your password'} minLength={signup ? 8 : 1} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {(error || (api === defaultApi && !configured)) && <div className="notice error" role="alert">{error || 'Backend not configured. Add the environment values described in README.md.'}</div>}
        {info && <div className="notice" role="status">{info}</div>}
        <button className="primary full" disabled={busy || (api === defaultApi && !configured)}>{busy ? 'Please wait...' : signup ? 'Create account' : 'Sign in'}<ArrowRight size={17} /></button>
      </form><p className="auth-fineprint"><ShieldCheck size={15} /> Owners manage only their own lots.<br />Visitors get a read-only view of published spaces.</p>
    </div></section>
  </main>
}
function LotCard({ lot, slots, stale, onSelect }: { lot: Lot; slots: Slot[]; stale: boolean; onSelect: () => void }) {
  const totals = counts(slots)
  return <button className="lot-card" onClick={onSelect}><div className="card-art"><ParkingSquare size={38} /><div className="art-lines"><span /><span /><span /><span /></div><span className={`pill ${lot.published ? '' : 'draft'}`}>{lot.published ? 'Published' : 'Draft'}</span></div><div className="card-content"><h3>{lot.name}</h3><p className="address"><MapPin size={14} />{lot.address}</p><p className="card-description">{lot.description || 'Parking, made simple.'}</p><div className="availability"><span><strong>{totals.free}</strong> / {slots.length} free{stale && <small>Last known</small>}</span><span className="card-arrow"><ChevronRight size={20} /></span></div><div className="occupancy-bar"><span style={{ width: `${slots.length ? totals.free / slots.length * 100 : 0}%` }} /></div><small className="card-unknown">{totals.unknown} unknown <span>Owner-marked demo</span></small></div></button>
}
function LotForm({ onCancel, onSave }: { onCancel: () => void; onSave: (draft: LotDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<LotDraft>({ name: '', address: '', description: '', rows: 2, spaces_per_row: 5 })
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  function change<K extends keyof LotDraft>(key: K, value: LotDraft[K]) {
    setDraft((old) => ({ ...old, [key]: value })); setPreview(false); setError('')
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    try {
      validateDraft(draft)
      if (!preview) { setPreview(true); return }
      setBusy(true); await onSave(draft)
    } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  return <section className="panel form-panel"><div className="section-title"><div><span className="eyebrow">MAKE ROOM FOR A BETTER DAY</span><h2>Create a parking lot</h2></div><button className="icon-button" aria-label="Cancel creation" onClick={onCancel}><X /></button></div><form onSubmit={(e) => void submit(e)}><div className="form-grid"><label>Lot name<input required maxLength={100} value={draft.name} onChange={(e) => change('name', e.target.value)} placeholder="e.g. City Mall or Riverside Office parking" /></label><label>Address<input required maxLength={240} value={draft.address} onChange={(e) => change('address', e.target.value)} placeholder="e.g. Main entrance, Market Road" /></label><label className="span-two">Description<textarea maxLength={1000} value={draft.description} onChange={(e) => change('description', e.target.value)} placeholder="Help visitors recognise your lot." /></label><label>Number of rows<input required type="number" min={1} max={26} step={1} value={draft.rows} onChange={(e) => change('rows', Number(e.target.value))} /></label><label>Spaces per row<input required type="number" min={1} max={20} step={1} value={draft.spaces_per_row} onChange={(e) => change('spaces_per_row', Number(e.target.value))} /></label></div><p className="muted">Up to 26 rows and 20 spaces per row. Slot IDs stay fixed after saving. New spaces start as unknown.</p>{preview && <div className="layout-preview"><h3>Layout preview <span className="pill draft">Not saved</span></h3><div className="map-scroll">{layoutLabels(draft.rows, draft.spaces_per_row).map((row, index) => <div className="slot-row" key={index}><span className="row-label">{String.fromCharCode(65 + index)}</span>{row.map((label) => <span className="slot unknown" key={label}><ParkingSquare size={20} /><strong>{label}</strong><small>Unknown</small></span>)}</div>)}</div></div>}{error && <div role="alert" className="notice error">{error}</div>}<div className="form-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving...' : preview ? 'Save draft lot' : 'Preview layout'}<ArrowRight size={16} /></button></div></form></section>
}
function LotDetail({ lot, slots, profile, stale, api, refresh, onBack }: { lot: Lot; slots: Slot[]; profile: Profile; stale: boolean; api: ParkingApi; refresh: () => Promise<void>; onBack: () => void }) {
  const editable = canEdit(profile, lot)
  const [picked, setPicked] = useState<{ id: string; anchor: HTMLButtonElement } | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const totals = counts(slots)
  async function act(action: () => Promise<void>) {
    setError(''); setBusy(true)
    try { await action(); setPicked(null); setEditing(false); await refresh() } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  const current = slots.find((s) => s.id === picked?.id)
  const manualCount = slots.filter((slot) => slot.input_mode === 'manual').length
  async function markAllFree() {
    if (!editable || stale || busy || manualCount === 0) return
    const confirmed = window.confirm(
      `Mark all ${manualCount} manual-input spaces in "${lot.name}" as free?\n\nOnly confirm if these spaces are empty. This replaces their current occupancy. Sensor-input spaces are not changed.`,
    )
    if (confirmed) await act(() => api.markAllFree(lot.id))
  }
  return <section className="detail"><button className="text-button back" onClick={onBack}> &larr; All parking lots</button><div className="detail-heading"><div><h2>{lot.name}</h2><p className="address"><MapPin size={16} />{lot.address}</p><p className="muted">{lot.description}</p></div><div className="detail-actions"><span className={`pill ${lot.published ? '' : 'draft'}`}>{lot.published ? 'Published' : 'Draft'}</span>{editable && <><button disabled={busy} onClick={() => setEditing(!editing)}>Edit details</button><button className="primary" disabled={busy} onClick={() => void act(() => api.publish(lot.id, !lot.published))}>{lot.published ? 'Unpublish lot' : 'Publish lot'}</button></>}</div></div>
    {error && <div role="alert" className="notice error">{error}</div>}
    {editing && <form className="panel edit-form" onSubmit={(e) => { e.preventDefault(); const fields = new FormData(e.currentTarget); void act(() => api.updateLot(lot.id, String(fields.get('name')), String(fields.get('address')), String(fields.get('description')))) }}><label>Lot name<input name="name" required maxLength={100} defaultValue={lot.name} /></label><label>Address<input name="address" required maxLength={240} defaultValue={lot.address} /></label><label>Description<textarea name="description" maxLength={1000} defaultValue={lot.description} /></label><p className="muted">Layout is fixed to preserve slot identities for future sensors.</p><button disabled={busy} className="primary">Save details</button></form>}
    <div className="stats"><div><span className="stat-dot free" /><strong>{totals.free}</strong><span>Free spaces</span></div><div><span className="stat-dot occupied" /><strong>{totals.occupied}</strong><span>Occupied</span></div><div><span className="stat-dot unknown" /><strong>{totals.unknown}</strong><span>Unknown</span></div><div><ParkingSquare size={20} /><strong>{slots.length}</strong><span>Total spaces</span></div></div>
    {stale && <div className="notice"><Clock3 size={17} /> These are last-known values, not live availability. Reconnect and refresh before relying on this map.</div>}
    {editable && <div className="bulk-actions"><button disabled={busy || stale || manualCount === 0} onClick={() => void markAllFree()}><Check size={17} />Mark all free</button><span className="muted">Current lot only. Requires confirmation; sensor-input spaces are unchanged.</span></div>}
    <div className="panel parking-map"><div className="section-title"><h3>Parking layout</h3><span className="muted">{lot.rows} rows &times; {lot.spaces_per_row} spaces</span></div><p className="muted">{editable ? 'Select a space to mark its availability. Updates appear for visitors automatically.' : 'Read-only map. Availability is marked manually by the lot owner.'}</p><div className="map-entry"><ArrowRight size={16} /> ENTRY / EXIT <span>SCHEMATIC - NOT TO SCALE</span></div><div className="map-scroll">{Array.from({ length: lot.rows }, (_, row) => <div className="slot-row" key={row}><span className="row-label">{String.fromCharCode(65 + row)}</span>{slots.filter((s) => s.row_index === row).map((slot) => {
      const content = <>{slot.occupancy === 'occupied' ? <CarFront size={24} /> : slot.occupancy === 'free' ? <Check size={23} /> : <ParkingSquare size={23} />}<strong>{slot.label}</strong><small>{slot.occupancy === 'unknown' ? 'Unknown' : slot.occupancy === 'free' ? 'Free' : 'Occupied'}</small>{slot.input_mode === 'sensor' && <small>Sensor</small>}</>
      const title = `${slot.label}: ${slot.occupancy}. Source: ${slot.input_source}. ${slot.observed_at ? `Last marked ${new Date(slot.observed_at).toLocaleString()}` : 'No observation yet'}.`
      return canEdit(profile, lot, slot) ? <button key={slot.id} className={`slot ${slot.occupancy} ${picked?.id === slot.id ? 'selected' : ''}`} aria-label={`${slot.label}: ${slot.occupancy}`} aria-haspopup="dialog" aria-expanded={picked?.id === slot.id} title={title} disabled={busy || stale} onClick={(e) => setPicked(picked?.id === slot.id ? null : { id: slot.id, anchor: e.currentTarget })}>{content}</button> : <div key={slot.id} className={`slot ${slot.occupancy}`} title={title} aria-label={`${slot.label}: ${slot.occupancy}`}>{content}</div>
    })}</div>)}</div><div className="legend"><span><i className="free" />Free</span><span><i className="occupied" />Occupied</span><span><i className="unknown" />Unknown</span><span className="legend-mode"><Radio size={14} />Manual demo</span></div></div>
    {current && picked && canEdit(profile, lot, current) && <SlotPopover key={current.id} slot={current} anchor={picked.anchor} disabled={busy || stale} onClose={() => setPicked(null)} onMark={(status) => void act(() => api.setSlot(current.id, status))} />}
    <div className="demo-note"><Radio size={19} /><p><strong>Manual demo mode.</strong> No sensors are connected. Owners can mark only manual-input slots; future sensor-input slots cannot be manually overridden.</p></div>
  </section>
}

function SlotPopover({ slot, anchor, disabled, onClose, onMark }: { slot: Slot; anchor: HTMLButtonElement; disabled: boolean; onClose: () => void; onMark: (status: Occupancy) => void }) {
  const panel = useRef<HTMLElement>(null)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  useLayoutEffect(() => {
    function place() {
      if (!panel.current) return
      const target = anchor.getBoundingClientRect()
      const { width, height } = panel.current.getBoundingClientRect()
      const gap = 10
      const right = target.right + gap
      const left = target.left - width - gap
      const fitsRight = right + width <= window.innerWidth - 12
      const fitsLeft = left >= 12
      const x = fitsRight ? right : fitsLeft ? left : target.left
      const y = fitsRight || fitsLeft ? target.top : target.bottom + gap
      setPosition({
        left: Math.max(12, Math.min(x, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(y, window.innerHeight - height - 12)),
      })
    }
    place()
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])
  useEffect(() => {
    function dismiss(e: PointerEvent) {
      if (e.target instanceof Node && !panel.current?.contains(e.target) && !anchor.contains(e.target)) onClose()
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); anchor.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [anchor, onClose])
  return createPortal(<section ref={panel} className="panel slot-popover" role="dialog" aria-label={`Update ${slot.label}`} style={position}>
    <div className="slot-popover-heading"><h3>Mark space {slot.label}</h3><button className="icon-button" aria-label="Close slot update" onClick={() => { onClose(); anchor.focus() }}><X size={18} /></button></div>
    <p className="muted">Manual input only. Currently {slot.occupancy}.</p>
    <div className="slot-actions">{(['free', 'occupied', 'unknown'] as Occupancy[]).map((status) => <button className={`mark ${status}`} key={status} disabled={disabled} onClick={() => onMark(status)}>{status === 'free' ? <Check size={16} /> : status === 'occupied' ? <CarFront size={16} /> : <ParkingSquare size={16} />}Mark {status}</button>)}</div>
  </section>, document.body)
}
