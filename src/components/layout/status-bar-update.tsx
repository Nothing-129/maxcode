"use client"

import { useRef, useState } from "react"
import { ArrowDown, CircleAlert, LoaderCircle } from "lucide-react"
import { useTranslations } from "next-intl"
import { useAppUpdate } from "@/components/providers/update-provider"
import { openUrl } from "@/lib/platform"
import { cn } from "@/lib/utils"

const RELEASES_URL = "https://github.com/Nothing-129/maxcode/releases/latest"

/** Version label with a filled circular update icon immediately to its right. */
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
  const showAction = available || isUpdating || restarting || ready || failed
  const percent =
    state.status === "downloading" && state.total && state.total > 0
      ? Math.min(100, Math.round(((state.downloaded ?? 0) / state.total) * 100))
      : null
  const label = restarting
    ? t("restarting")
    : isUpdating || actionPending
      ? state.status === "downloading"
        ? `${t("downloading")}${percent !== null ? ` ${percent}%` : ""}`
        : t("updating")
      : ready
        ? t("restartToUpdate")
        : failed
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

  return (
    <div className="flex h-6 items-center gap-1 whitespace-nowrap font-mono tabular-nums">
      <button
        type="button"
        title={checking ? t("checking") : t("checkUpdate")}
        aria-busy={checking}
        disabled={checking || busy || ready}
        onClick={() => void checkNow({ silent: false })}
        className="flex h-6 items-center gap-1 rounded px-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        {currentVersion ? `v${currentVersion}` : "v—"}
        {checking && (
          <LoaderCircle
            aria-hidden="true"
            className="size-3 animate-spin motion-reduce:animate-none"
          />
        )}
      </button>
      {showAction && (
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={busy}
          onClick={() => void handleUpdate()}
          className={cn(
            "group flex h-5 shrink-0 items-center justify-center gap-0.5 rounded-full px-1 transition-all group-hover:px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
            failed
              ? "bg-destructive text-white hover:bg-destructive/90"
              : "bg-[#3ca1ef] text-white hover:bg-[#3ca1ef]/90"
          )}
        >
          {busy ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-3 animate-spin motion-reduce:animate-none"
            />
          ) : failed ? (
            <CircleAlert
              aria-hidden="true"
              className="size-3"
              strokeWidth={2.5}
            />
          ) : (
            <>
              <ArrowDown
                aria-hidden="true"
                className="size-3 group-hover:hidden"
                strokeWidth={2.5}
              />
              <span className="hidden text-2xs font-medium group-hover:inline">
                {t("updateAction")}
              </span>
            </>
          )}
        </button>
      )}
    </div>
  )
}
