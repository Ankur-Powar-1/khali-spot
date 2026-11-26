import { createClient, type Session } from '@supabase/supabase-js'
import { validateDraft, type LotDraft, type Occupancy, type Profile, type Role, type Snapshot } from './domain'

export interface ParkingApi {
  session(): Promise<Session | null>
  onAuth(callback: (session: Session | null) => void): () => void
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string, role: Role): Promise<boolean>
  signOut(): Promise<void>
  profile(id: string): Promise<Profile>
  snapshot(): Promise<Snapshot>
  subscribe(change: () => void, status: (connected: boolean) => void): () => void
  createLot(draft: LotDraft): Promise<string>
  updateLot(id: string, name: string, address: string, description: string): Promise<void>
  publish(id: string, published: boolean): Promise<void>
  setSlot(id: string, occupancy: Occupancy): Promise<void>
  markAllFree(lotId: string): Promise<void>
}
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const configured = Boolean(url && key && !url.includes('your-project') && !key.includes('your-browser'))
const supabase = configured ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null
function client() {
  if (!supabase) throw new Error('Supabase is not configured. Follow README.md before signing in.')
  return supabase
}
export const api: ParkingApi = {
  async session() {
    const { data, error } = await client().auth.getSession()
    if (error) throw error
    return data.session
  },
  onAuth(callback) {
    const { data } = client().auth.onAuthStateChange((_event, session) => callback(session))
    return () => data.subscription.unsubscribe()
  },
  async signIn(email, password) {
    const { error } = await client().auth.signInWithPassword({ email, password })
    if (error) throw error
  },
  async signUp(email, password, role) {
    const { data, error } = await client().auth.signUp({
      email, password, options: { data: { role }, emailRedirectTo: window.location.origin },
    })
    if (error) throw error
    return Boolean(data.session)
  },
  async signOut() {
    const { error } = await client().auth.signOut()
    if (error) throw error
  },
  async profile(id) {
    const { data, error } = await client().from('profiles').select('id,role').eq('id', id).single()
    if (error) throw new Error(`Cannot load account role. Check database setup. ${error.message}`)
    if (data.role !== 'owner' && data.role !== 'visitor') throw new Error('Account has an invalid role.')
    return data as Profile
  },
  async snapshot() {
    const { data, error } = await client().rpc('parking_snapshot')
    if (error) throw new Error(`Parking data unavailable. ${error.message}`)
    return data as Snapshot
  },
  subscribe(change, status) {
    const channel = client().channel(`parking-${crypto.randomUUID()}`, {
      config: { postgres_changes_options: { wait: true } },
    })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'parking_revision' }, change)
      .on('system', {}, (event) => { if (event.status === 'error') status(false) })
      .subscribe((state) => status(state === 'SUBSCRIBED'))
    return () => { void client().removeChannel(channel) }
  },
  async createLot(draft) {
    validateDraft(draft)
    const { data, error } = await client().rpc('create_parking_lot', {
      p_name: draft.name.trim(), p_address: draft.address.trim(), p_description: draft.description.trim(),
      p_rows: draft.rows, p_spaces: draft.spaces_per_row,
    })
    if (error) throw error
    return data as string
  },
  async updateLot(id, name, address, description) {
    validateDraft({ name, address, description, rows: 1, spaces_per_row: 1 })
    const { error } = await client().rpc('update_parking_lot', {
      p_id: id, p_name: name.trim(), p_address: address.trim(), p_description: description.trim(),
    })
    if (error) throw error
  },
  async publish(id, published) {
    const { error } = await client().rpc('publish_parking_lot', { p_id: id, p_published: published })
    if (error) throw error
  },
  async setSlot(id, occupancy) {
    const { error } = await client().rpc('set_manual_occupancy', { p_id: id, p_occupancy: occupancy })
    if (error) throw error
  },
  async markAllFree(lotId) {
    const { error } = await client().rpc('mark_all_manual_free', { p_lot_id: lotId })
    if (error?.code === 'PGRST202') {
      throw new Error('Bulk action needs database setup. Run supabase/migrations/002_mark_all_free.sql once in the Supabase SQL Editor.')
    }
    if (error) throw error
  },
}
