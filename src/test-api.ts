import type { Session } from '@supabase/supabase-js'
import { vi } from 'vitest'
import type { ParkingApi } from './api'
import type { Lot, Role, Slot } from './domain'

export const fixtureLot: Lot = {
  id: 'lot-1', owner_id: 'owner-1', name: 'Library parking', address: 'Main entrance, Market Road',
  description: 'A quieter start to your day.', rows: 2, spaces_per_row: 5, published: true,
  created_at: '2026-11-26T08:00:00Z',
}
export const fixtureSlots: Slot[] = Array.from({ length: 10 }, (_, index) => ({
  id: `slot-${index}`, lot_id: fixtureLot.id, label: `${index < 5 ? 'A' : 'B'}${index % 5 + 1}`,
  row_index: Math.floor(index / 5), position: index % 5 + 1,
  occupancy: index === 0 ? 'free' : index === 1 ? 'occupied' : 'unknown',
  input_mode: 'manual', input_source: 'manual_demo', observed_at: index < 2 ? '2026-11-26T08:00:00Z' : null,
  updated_at: '2026-11-26T08:00:00Z',
}))
export function testApi(role: Role = 'owner', signedIn = true) {
  const userId = role === 'owner' ? 'owner-1' : 'visitor-1'
  const session = { user: { id: userId } } as Session
  let authCallback: (session: Session | null) => void = () => {}
  let changed: () => void = () => {}
  let status: (online: boolean) => void = () => {}
  let lots = structuredClone([fixtureLot])
  let slots = structuredClone(fixtureSlots)
  const api: ParkingApi = {
    session: vi.fn(async () => signedIn ? session : null),
    onAuth: vi.fn((callback) => { authCallback = callback; return vi.fn() }),
    signIn: vi.fn(async () => { authCallback(session) }),
    signUp: vi.fn(async () => false),
    signOut: vi.fn(async () => { authCallback(null) }),
    profile: vi.fn(async () => ({ id: userId, role })),
    snapshot: vi.fn(async () => structuredClone({ lots, slots })),
    subscribe: vi.fn((change, online) => { changed = change; status = online; queueMicrotask(() => online(true)); return vi.fn() }),
    createLot: vi.fn(async (draft) => {
      lots = [{ ...fixtureLot, ...draft, published: false }]
      slots = structuredClone(fixtureSlots).map((slot) => ({ ...slot, occupancy: 'unknown', observed_at: null }))
      changed()
      return fixtureLot.id
    }),
    updateLot: vi.fn(async (_id, name, address, description) => { lots[0] = { ...lots[0], name, address, description }; changed() }),
    publish: vi.fn(async (_id, published) => { lots[0].published = published; changed() }),
    setSlot: vi.fn(async (id, occupancy) => {
      slots = slots.map((s) => s.id === id ? { ...s, occupancy, observed_at: new Date().toISOString() } : s)
      changed()
    }),
    markAllFree: vi.fn(async (lotId) => {
      slots = slots.map((s) => s.lot_id === lotId && s.input_mode === 'manual'
        ? { ...s, occupancy: 'free', observed_at: new Date().toISOString() } : s)
      changed()
    }),
  }
  return {
    api, session,
    emit: () => changed(),
    disconnect: () => status(false),
    reconnect: () => status(true),
    auth: (value: Session | null) => authCallback(value),
    changeSlots: (values: Slot[]) => { slots = values; changed() },
    changeLots: (values: Lot[]) => { lots = values; changed() },
  }
}
