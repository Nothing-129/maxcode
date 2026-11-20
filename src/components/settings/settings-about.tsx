"use client"

import { ArrowDownToLine, LoaderCircle } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import {
  UpdateProvider,
  useAppUpdate,
} from "@/components/providers/update-provider"
import { StatusBarUpdate } from "@/components/layout/status-bar-update"

export function SettingsAbout({ compact = false }: { compact?: boolean } = {}) {
  const update = useAppUpdate()
  const system = useTranslations("SystemSettings")
  const pending = useRef(false)
  const [acting, setActing] = useState(false)
  const ready = update?.state.status === "ready_to_restart"
  const busy =
    acting || update?.isBusy || update?.isUpdating || update?.checking
  if (compact) {
    if (
      !update?.available &&
      !ready &&
      !update?.isUpdating &&
      !update?.isRestarting
    )
      return null
    const label = ready
      ? system("restartToUpdate")
      : update?.isUpdating
        ? system("downloading")
        : system("checkUpdate")
    return (
      <button
        type="button"
        aria-label={label}
        aria-busy={!!busy}
        disabled={!!busy}
        title={[label, update?.currentVersion, update?.available?.version]
          .filter(Boolean)
          .join(" · ")}
        onClick={async () => {
          if (!update || pending.current || busy) return
          pending.current = true
          setActing(true)
          try {
            if (ready) await update.restart()
            else await update.checkNow({ silent: false })
          } finally {
            pending.current = false
            setActing(false)
          }
        }}
        className="relative flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        {busy ? (
          <LoaderCircle
            className="size-[1.125rem] animate-spin motion-reduce:animate-none"
            strokeWidth={1.7}
          />
        ) : (
          <ArrowDownToLine
            data-version-update
            className="size-[1.125rem] text-blue-500"
            strokeWidth={1.7}
          />
        )}
      </button>
    )
  }
  if (!update) {
    return (
      <UpdateProvider>
        <SettingsAbout />
      </UpdateProvider>
    )
  }
  const { status, version } = update.state
  const currentVersion = update.currentVersion.replace(/^v/, "")
  const targetVersion = (version || update.available?.version)?.replace(
    /^v/,
    ""
  )
  let message = `${system("currentVersion")} ${currentVersion ? `v${currentVersion}` : "—"}`
  if (ready || status === "restarting" || update.isRestarting) {
    message = targetVersion
      ? system("footerUpdateReady", { version: targetVersion })
      : system("updateReadyHint")
  } else if (status === "error") {
    message = system("updateFailedStatus")
  } else if (update.checkError && !update.checking && !update.isUpdating) {
    message = system("checkUpdateFailed", { message: update.checkError })
  } else if (targetVersion) {
    message = system("foundUpdate", { version: targetVersion })
  }

  return (
    <div className="ms-2 mt-3 flex shrink-0 items-baseline gap-1.5 border-t border-sidebar-border pt-3 text-[0.6875rem] leading-4">
      <span
        role="status"
        className="min-w-0 flex-1 wrap-anywhere text-muted-foreground"
      >
        {message}
      </span>
      <StatusBarUpdate inline />
    </div>
  )
}
