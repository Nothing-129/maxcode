"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  CODEX_QUOTA_REFRESH_MS,
  readCodexQuota,
  type CodexQuota,
} from "@/lib/codex-quota"
import { onTransportReconnect, subscribe } from "@/lib/platform"

export function useCodexQuota() {
  const [quota, setQuota] = useState<CodexQuota | null>(null)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const pending = useRef<number | null>(null)
  const checked = useRef(0)
  const mounted = useRef(false)

  const refresh = useCallback(async (force = false) => {
    const current = generation.current
    if (!mounted.current || pending.current === current) return
    pending.current = current
    setLoading(true)
    try {
      const next = await readCodexQuota(force)
      if (mounted.current && generation.current === current) {
        checked.current = Date.now()
        setQuota(next)
      }
    } catch {
      if (mounted.current && generation.current === current) {
        setQuota((previous) =>
          previous ? { ...previous, error: "unavailable" } : null
        )
      }
    } finally {
      if (pending.current === current) pending.current = null
      if (mounted.current && generation.current === current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh()
    }, CODEX_QUOTA_REFRESH_MS)
    const wake = () => {
      if (
        document.visibilityState !== "hidden" &&
        Date.now() - checked.current >= CODEX_QUOTA_REFRESH_MS
      ) {
        void refresh()
      }
    }
    const invalidate = () => {
      generation.current += 1
      checked.current = 0
      setQuota(null)
      void refresh(true)
    }
    const stopReconnect = onTransportReconnect(invalidate)
    let disposed = false
    let stopSubscription = () => {}
    const subscription = subscribe("app://acp-agents-updated", invalidate)
    void subscription
      .then((stop) => {
        if (disposed) stop()
        else stopSubscription = stop
      })
      .catch(() => {})
    document.addEventListener("visibilitychange", wake)
    window.addEventListener("online", wake)
    return () => {
      mounted.current = false
      generation.current += 1
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", wake)
      window.removeEventListener("online", wake)
      stopReconnect?.()
      stopSubscription()
    }
  }, [refresh])

  return { quota, loading, refresh: () => refresh(true) }
}
