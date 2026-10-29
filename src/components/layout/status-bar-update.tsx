"use client"

import { statusBarActionClassName } from "./status-bar-action"

import { useRef, useState } from "react"
import { ArrowDown, CircleAlert, LoaderCircle, Package } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAppUpdate } from "@/components/providers/update-provider"
import { openUrl } from "@/lib/platform"
import { describeAppUpdateError, usesElectronInstaller } from "@/lib/updater"
import { cn } from "@/lib/utils"

const RELEASES_URL = "https://github.com/Nothing-129/maxcode/releases/latest"

/** One stable version action whose leading icon reflects update state. */
export function StatusBarUpdate() {
  const t = useTranslations("SystemSettings")
  const update = useAppUpdate()
  const pending = useRef(false)
  const [actionPending, setActionPending] = useState(false)
  if (!update) return null

  const {
    state,
    available,
    currentVersion,
    isUpdating,
    isRestarting,
    restartCountdown,
    isBusy,
    canInstallInPlace,
    selfUpdateBlocker,
    runtime,
    checking,
    checkNow,
    startUpdate,
    restart,
  } = update
  const restarting =
    isRestarting || restartCountdown !== null || state.status === "restarting"
  const ready = state.status === "ready_to_restart"
  const failed = state.status === "error"
  const busy = actionPending || isBusy || isUpdating || restarting
  const desktopAutoDownload =
    usesElectronInstaller() || (runtime === "electron" && canInstallInPlace)
  // Desktop offers an install action only once the verified package is ready.
  // Failed background downloads can be retried by checking the version again.
  const showAction = desktopAutoDownload
    ? ready || restarting
    : available || isUpdating || restarting || ready || failed
  const percent =
    state.status === "downloading" && state.total && state.total > 0
      ? Math.min(100, Math.round(((state.downloaded ?? 0) / state.total) * 100))
      : null
  const reason = selfUpdateBlocker
    ? describeAppUpdateError(
        selfUpdateBlocker.message,
        "install",
        selfUpdateBlocker
      )
    : failed && state.error
      ? describeAppUpdateError(state.error, "install", state.errorInfo)
      : null
  const reasonText = reason ? t(reason.key, reason.values) : null
  const label = restarting
    ? t("restarting")
    : isUpdating || actionPending
      ? state.status === "downloading"
        ? `${t("downloading")}${percent !== null ? ` ${percent}%` : ""}`
        : t("updating")
      : ready
        ? t("restartToUpdate")
        : failed && canInstallInPlace
          ? `${t("updateFailedStatus")} · ${t("retry")}`
          : canInstallInPlace
            ? t("downloadAndRestart")
            : t("viewRelease", { version: available?.version ?? "" })

  const handleUpdate = async () => {
    if (pending.current || busy) return
    pending.current = true
    setActionPending(true)
    try {
      if (ready) await restart()
      else if (canInstallInPlace) await startUpdate()
      else await openUrl(RELEASES_URL)
    } finally {
      pending.current = false
      setActionPending(false)
    }
  }

  const targetVersion = state.version || available?.version
  const actionTitle = [label, targetVersion].filter(Boolean).join(" · ")
  const title = showAction
    ? reasonText
      ? `${actionTitle} — ${reasonText}`
      : actionTitle
    : checking
      ? t("checking")
      : t("checkUpdate")

  return (
    <div className="flex h-6 items-center whitespace-nowrap font-mono tabular-nums">
      <button
        type="button"
        title={title}
        aria-label={showAction ? label : undefined}
        aria-busy={checking || busy}
        disabled={checking || busy}
        onClick={() => {
          if (showAction) void handleUpdate()
          else void checkNow({ silent: false })
        }}
        className={cn(statusBarActionClassName, "flex items-center gap-1.5")}
      >
        {checking || busy ? (
          <LoaderCircle
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 animate-spin motion-reduce:animate-none",
              showAction && "text-[#216ae4]"
            )}
          />
        ) : showAction ? (
          failed ? (
            <CircleAlert
              aria-hidden="true"
              className="size-3 shrink-0 text-destructive"
            />
          ) : (
            <ArrowDown
              aria-hidden="true"
              strokeWidth={2.75}
              className="size-4 shrink-0 text-[#216ae4] motion-safe:animate-[update-arrow-nudge_4s_ease-in-out_infinite]"
            />
          )
        ) : (
          <Package aria-hidden="true" className="size-3 shrink-0" />
        )}
        {currentVersion || "—"}
      </button>
      {selfUpdateBlocker && reasonText && (
        <span
          role="status"
          className="max-w-80 truncate text-2xs text-muted-foreground"
          title={reasonText}
        >
          {reasonText}
        </span>
      )}
    </div>
  )
}
