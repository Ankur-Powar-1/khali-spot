import { describe, expect, it } from 'vitest'
import { canEdit, counts, layoutLabels, validateDraft, type Lot, type Slot } from './domain'

describe('layouts and authorization', () => {
  it('generates the requested 2x5 labels and supports Z20', () => {
    expect(layoutLabels(2, 5)).toEqual([['A1', 'A2', 'A3', 'A4', 'A5'], ['B1', 'B2', 'B3', 'B4', 'B5']])
    expect(layoutLabels(26, 20)[25][19]).toBe('Z20')
  })
  it.each([[0, 5], [27, 1], [1, 0], [1, 21], [1.5, 2], [NaN, 5]])('rejects invalid dimensions %s x %s', (rows, spaces) => {
    expect(() => layoutLabels(rows, spaces)).toThrow('whole numbers')
  })
  it('validates details instead of creating anonymous lots', () => {
    expect(() => validateDraft({ name: ' ', address: 'Gate', description: '', rows: 2, spaces_per_row: 5 })).toThrow('lot name')
    expect(() => validateDraft({ name: 'Library', address: ' ', description: '', rows: 2, spaces_per_row: 5 })).toThrow('address')
    expect(() => validateDraft({ name: 'Library', address: 'Gate', description: 'a'.repeat(1001), rows: 2, spaces_per_row: 5 })).toThrow('1,000')
  })
  it('counts unknown separately, never as free', () => {
    expect(counts([{ occupancy: 'free' }, { occupancy: 'occupied' }, { occupancy: 'unknown' }] as Slot[])).toEqual({ free: 1, occupied: 1, unknown: 1 })
  })
  it('allows only the owning owner and only manual-input slots', () => {
    const lot = { id: 'lot', owner_id: 'owner' } as Lot
    const manual = { lot_id: 'lot', input_mode: 'manual' } as Slot
    expect(canEdit({ id: 'owner', role: 'owner' }, lot, manual)).toBe(true)
    expect(canEdit({ id: 'other', role: 'owner' }, lot, manual)).toBe(false)
    expect(canEdit({ id: 'owner', role: 'visitor' }, lot, manual)).toBe(false)
    expect(canEdit({ id: 'owner', role: 'owner' }, lot, { ...manual, input_mode: 'sensor' })).toBe(false)
    expect(canEdit({ id: 'owner', role: 'owner' }, lot, { ...manual, lot_id: 'other-lot' })).toBe(false)
  })
})
