import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useParking } from './useParking'
import { fixtureLot, fixtureSlots, testApi } from './test-api'
import type { Snapshot } from './domain'

describe('realtime reconciliation', () => {
  it('refetches after an event received during an in-flight snapshot', async () => {
    const fixture = testApi()
    let resolve!: (value: Snapshot) => void
    vi.mocked(fixture.api.snapshot).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const { result } = renderHook(() => useParking(fixture.api, 'owner-1'))
    act(() => fixture.changeSlots(fixtureSlots.map((s) => ({ ...s, occupancy: 'occupied' }))))
    await act(async () => resolve({ lots: [fixtureLot], slots: fixtureSlots }))
    await waitFor(() => expect(result.current.data.slots.every((s) => s.occupancy === 'occupied')).toBe(true))
    expect(fixture.api.snapshot).toHaveBeenCalledTimes(2)
  })
  it('keeps the last snapshot but marks it stale on a failed refresh', async () => {
    const fixture = testApi()
    const { result } = renderHook(() => useParking(fixture.api, 'owner-1'))
    await waitFor(() => expect(result.current.stale).toBe(false))
    vi.mocked(fixture.api.snapshot).mockRejectedValue(new Error('Network unavailable'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.data.lots).toHaveLength(1)
    expect(result.current.stale).toBe(true)
    expect(result.current.error).toBe('Network unavailable')
  })
  it('does not accept a previous user response after an account change', async () => {
    const fixture = testApi()
    let resolve!: (value: Snapshot) => void
    vi.mocked(fixture.api.snapshot).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useParking(fixture.api, id), { initialProps: { id: 'owner-1' as string | undefined } })
    rerender({ id: undefined })
    await act(async () => resolve({ lots: [fixtureLot], slots: fixtureSlots }))
    expect(result.current.data.lots).toEqual([])
    expect(result.current.syncedAt).toBeNull()
  })
})
