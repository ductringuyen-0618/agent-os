import type { Event } from '@agentos/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseEventsOptions {
  maxBuffer?: number
}
export interface UseEventsResult {
  events: Event[]
  connected: boolean
  clear: () => void
}

export function wsUrl(): string {
  const token =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('agentosToken')
      : null
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const base = `${proto}://${window.location.host}/ws`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

export function useEvents(
  filter?: (e: Event) => boolean,
  opts: UseEventsOptions = {},
): UseEventsResult {
  const maxBuffer = opts.maxBuffer ?? 500
  const [events, setEvents] = useState<Event[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const filterRef = useRef(filter)
  filterRef.current = filter

  useEffect(() => {
    let disposed = false
    let retryMs = 1000
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (disposed) return
      const socket = new WebSocket(wsUrl())
      wsRef.current = socket
      socket.onopen = () => {
        if (disposed) return
        setConnected(true)
        retryMs = 1000
      }
      socket.onclose = () => {
        if (disposed) return
        setConnected(false)
        reconnectTimer = setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, 15000)
      }
      socket.onerror = () => socket.close()
      socket.onmessage = (msg: { data: string }) => {
        if (disposed) return
        try {
          const e = JSON.parse(msg.data) as Event
          if (filterRef.current && !filterRef.current(e)) return
          setEvents((prev) => {
            const next = [...prev, e]
            return next.length > maxBuffer
              ? next.slice(next.length - maxBuffer)
              : next
          })
        } catch {
          /* ignore unparseable frame */
        }
      }
    }
    connect()
    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [maxBuffer])

  const clear = useCallback(() => setEvents([]), [])
  return { events, connected, clear }
}
