"use client"

import { useEffect } from "react"
import { RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { useIsMobile } from "@/hooks/use-mobile"
import { getTransport } from "@/lib/transport"
import { refreshFrontend } from "@/lib/refresh-frontend"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"

export function MobileFrontendRefresh() {
  const isMobile = useIsMobile()
  const t = useTranslations("Folder.folderTitleBar")

  useEffect(() => {
    if (!isMobile) return
    const buildId = process.env.NEXT_PUBLIC_FRONTEND_BUILD_ID
    if (!buildId) return
    let disposed = false
    let pending = false
    let notified = false
    let controller: AbortController | undefined
    let notification: string | number | undefined
    const check = async () => {
      if (disposed || pending || document.visibilityState === "hidden") return
      pending = true
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 10000)
      try {
        const response = await fetch("/frontend-version.json", {
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) return
        const latest: unknown = await response.json()
        if (
          disposed ||
          !latest ||
          typeof latest !== "object" ||
          !("buildId" in latest) ||
          typeof latest.buildId !== "string" ||
          !latest.buildId ||
          latest.buildId === buildId
        )
          return
        if (!notified) {
          notified = true
          notification = toast(t("frontendUpdated"), {
            duration: Infinity,
            action: { label: t("refreshInterface"), onClick: refreshFrontend },
          })
        }
      } catch {
        // Offline and older servers remain usable; retry on the next wake/reconnect.
      } finally {
        window.clearTimeout(timeout)
        pending = false
      }
    }
    const wake = () => void check()
    wake()
    window.addEventListener("focus", wake)
    window.addEventListener("pageshow", wake)
    document.addEventListener("visibilitychange", wake)
    const unsubscribe = getTransport().onReconnect?.(wake)
    return () => {
      disposed = true
      controller?.abort()
      unsubscribe?.()
      window.removeEventListener("focus", wake)
      window.removeEventListener("pageshow", wake)
      document.removeEventListener("visibilitychange", wake)
      if (notification !== undefined) toast.dismiss(notification)
    }
  }, [isMobile, t])

  return null
}

export function MobileFrontendRefreshItem() {
  const isMobile = useIsMobile()
  const t = useTranslations("Folder.folderTitleBar")
  if (!isMobile) return null
  return (
    <DropdownMenuItem className="min-h-11" onSelect={refreshFrontend}>
      <RefreshCw />
      {t("refreshInterface")}
    </DropdownMenuItem>
  )
}
