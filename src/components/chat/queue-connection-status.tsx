"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export function QueueConnectionStatus({
  waiting,
  failed,
  onReconnect,
}: {
  waiting: boolean
  failed: boolean
  onReconnect?: () => Promise<void>
}) {
  const t = useTranslations("Folder.chat.messageQueue")
  const [slow, setSlow] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const retryingRef = useRef(false)
  useEffect(() => {
    if (!waiting || failed) return
    const timer = setTimeout(() => setSlow(true), 15_000)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [waiting, failed])

  if (!waiting) return null

  return (
    <div className="mx-3 mb-1 flex items-center gap-2 text-xs text-muted-foreground">
      {!failed && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
      <span role="status" className="min-w-0 flex-1">
        {t(
          failed
            ? "connectionFailed"
            : slow
              ? "connectionSlow"
              : "waitingConnection"
        )}
      </span>
      {(failed || slow) && onReconnect && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          disabled={retrying}
          onClick={async () => {
            if (retryingRef.current) return
            retryingRef.current = true
            setRetrying(true)
            try {
              await onReconnect()
            } finally {
              retryingRef.current = false
              setRetrying(false)
            }
          }}
        >
          {t("reconnect")}
        </Button>
      )}
    </div>
  )
}
