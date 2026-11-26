import { useCallback, useEffect, useRef, useState } from 'react'
import type { ParkingApi } from './api'
import type { Snapshot } from './domain'

export function useParking(api: ParkingApi, userId: string | undefined) {
  const [data, setData] = useState<Snapshot>({ lots: [], slots: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let active = true
    let running: Promise<void> | null = null
    let dirty = false
    setData({ lots: [], slots: [] })
    setError('')
    setSyncedAt(null)
    setLoading(Boolean(userId))
    setConnected(false)
    if (!userId) return
    const refresh = (): Promise<void> => {
      dirty = true
      if (running) return running
      running = (async () => {
        while (dirty && active) {
          dirty = false
          try {
            const snapshot = await api.snapshot()
            if (active) { setData(snapshot); setSyncedAt(Date.now()); setError('') }
          } catch (e) {
            if (active) setError(e instanceof Error ? e.message : 'Parking data could not be loaded.')
          } finally {
            if (active) setLoading(false)
          }
        }
      })().finally(() => { running = null })
      return running
    }
    refreshRef.current = refresh
    const unsubscribe = api.subscribe(() => { void refresh() }, (online) => {
      if (!active) return
      setConnected(online)
      if (online) void refresh()
    })
    const offline = () => setConnected(false)
    const online = () => { void refresh() }
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh() }, 30000)
    void refresh()
    return () => {
      active = false
      unsubscribe()
      window.clearInterval(timer)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', visible)
      refreshRef.current = async () => {}
    }
  }, [api, userId])
  const refresh = useCallback(() => refreshRef.current(), [])
  const stale = !connected || Boolean(error) || !syncedAt || now - syncedAt > 60000
  return { data, error, loading, connected, syncedAt, stale, refresh }
}
