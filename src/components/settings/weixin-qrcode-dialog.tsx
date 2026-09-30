"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, Loader2, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { SettingsError } from "@/components/shared/settings-section"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { weixinGetQrcode, weixinCheckQrcode } from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"

/** Client-side QR code expiry (5 minutes). */
const QR_EXPIRY_MS = 5 * 60 * 1000
/** Show a warning after this many consecutive polling failures. */
const POLL_ERROR_WARN_THRESHOLD = 3

interface WeixinQrcodeDialogProps {
  open: boolean
  channelId: number
  onOpenChange: (open: boolean) => void
  onAuthSuccess: (channelId: number) => void
}

function WeixinQrcodeContent({
  channelId,
  onAuthSuccess,
  onClose,
}: {
  channelId: number
  onAuthSuccess: (channelId: number) => void
  onClose: () => void
}) {
  const t = useTranslations("ChatChannelSettings")
  const [qrcodeImg, setQrcodeImg] = useState<string | null>(null)
  const [qrcodeId, setQrcodeId] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "waiting" | "expired">(
    "loading"
  )
  const [error, setError] = useState<string | null>(null)
  const [pollErrors, setPollErrors] = useState(0)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stabilise callbacks via ref so the polling effect doesn't re-trigger
  const onAuthSuccessRef = useRef(onAuthSuccess)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onAuthSuccessRef.current = onAuthSuccess
    onCloseRef.current = onClose
  })

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    if (expiryRef.current) {
      clearTimeout(expiryRef.current)
      expiryRef.current = null
    }
  }, [])

  const fetchQrcode = useCallback(async () => {
    setStatus("loading")
    setError(null)
    setQrcodeImg(null)
    setQrcodeId(null)
    setPollErrors(0)
    stopPolling()

    try {
      const result = await weixinGetQrcode()
      setQrcodeId(result.qrcode_id)

      if (result.qrcode_img_content) {
        const raw = result.qrcode_img_content
        const imgSrc = raw.startsWith("data:")
          ? raw
          : `data:image/png;base64,${raw}`
        setQrcodeImg(imgSrc)
      }

      setStatus("waiting")
    } catch (err) {
      const msg = toErrorMessage(err)
      setError(msg)
      setStatus("expired")
    }
  }, [stopPolling])

  // Fetch QR code on mount + cleanup on unmount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    fetchQrcode()
    return () => stopPolling()
  }, [fetchQrcode, stopPolling])

  // Start polling + expiry timer when we have a qrcodeId
  useEffect(() => {
    if (!qrcodeId || status !== "waiting") return

    // Client-side expiry guard
    expiryRef.current = setTimeout(() => {
      stopPolling()
      setStatus("expired")
    }, QR_EXPIRY_MS)

    pollingRef.current = setInterval(async () => {
      try {
        const result = await weixinCheckQrcode(channelId, qrcodeId)
        setPollErrors(0)
        if (result.status === "confirmed") {
          stopPolling()
          onAuthSuccessRef.current(channelId)
          onCloseRef.current()
        } else if (result.status === "expired") {
          stopPolling()
          setStatus("expired")
        }
      } catch {
        setPollErrors((n) => n + 1)
      }
    }, 2000)

    return () => stopPolling()
  }, [qrcodeId, status, channelId, stopPolling])

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <p className="text-sm text-muted-foreground text-center">
        {t("weixinScanDescription")}
      </p>

      {status === "loading" && (
        <div className="flex h-48 w-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {status === "waiting" && qrcodeImg && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrcodeImg}
            alt="WeChat QR Code"
            className="h-48 w-48 rounded-md"
            referrerPolicy="no-referrer"
          />
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("weixinWaitingScan")}
          </p>
          {pollErrors >= POLL_ERROR_WARN_THRESHOLD && (
            <div className="flex items-center gap-1.5 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-1.5 text-xs text-yellow-500">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {t("weixinPollError")}
            </div>
          )}
        </>
      )}

      {status === "expired" && (
        <>
          <div className="flex h-48 w-48 items-center justify-center rounded-md bg-muted">
            <p className="text-sm text-muted-foreground">
              {t("weixinQrcodeExpired")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchQrcode}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            {t("weixinRefreshQrcode")}
          </Button>
        </>
      )}

      {error && <SettingsError>{error}</SettingsError>}
    </div>
  )
}

export function WeixinQrcodeDialog({
  open,
  channelId,
  onOpenChange,
  onAuthSuccess,
}: WeixinQrcodeDialogProps) {
  const t = useTranslations("ChatChannelSettings")
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("weixinScanTitle")}</DialogTitle>
        </DialogHeader>
        {open && (
          <WeixinQrcodeContent
            channelId={channelId}
            onAuthSuccess={onAuthSuccess}
            onClose={handleClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
