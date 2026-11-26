export type Role = 'owner' | 'visitor'
export type Occupancy = 'free' | 'occupied' | 'unknown'
export type InputMode = 'manual' | 'sensor'
export interface Profile { id: string; role: Role }
export interface Lot {
  id: string; owner_id: string; name: string; address: string; description: string
  rows: number; spaces_per_row: number; published: boolean; created_at: string
}
export interface Slot {
  id: string; lot_id: string; label: string; row_index: number; position: number
  occupancy: Occupancy; input_mode: InputMode; input_source: string
  observed_at: string | null; updated_at: string
}
export interface LotDraft { name: string; address: string; description: string; rows: number; spaces_per_row: number }
export interface Snapshot { lots: Lot[]; slots: Slot[] }

export function validateLayout(rows: number, spaces: number) {
  if (!Number.isInteger(rows) || rows < 1 || rows > 26 ||
      !Number.isInteger(spaces) || spaces < 1 || spaces > 20) {
    throw new Error('Use 1-26 rows and 1-20 spaces per row (whole numbers).')
  }
}
export function layoutLabels(rows: number, spaces: number) {
  validateLayout(rows, spaces)
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: spaces }, (_, s) => `${String.fromCharCode(65 + r)}${s + 1}`))
}
export function validateDraft(draft: LotDraft) {
  validateLayout(draft.rows, draft.spaces_per_row)
  if (!draft.name.trim() || draft.name.trim().length > 100) throw new Error('Enter a lot name (up to 100 characters).')
  if (!draft.address.trim() || draft.address.trim().length > 240) throw new Error('Enter an address (up to 240 characters).')
  if (draft.description.length > 1000) throw new Error('Description must be 1,000 characters or fewer.')
}
export function counts(slots: Slot[]) {
  return slots.reduce((result, slot) => {
    result[slot.occupancy]++
    return result
  }, { free: 0, occupied: 0, unknown: 0 })
}
export function canEdit(profile: Profile, lot: Lot, slot?: Slot) {
  return profile.role === 'owner' && profile.id === lot.owner_id &&
    (!slot || (slot.lot_id === lot.id && slot.input_mode === 'manual'))
}
