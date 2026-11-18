"use client"

import { ArrowDownToLine, Info, LoaderCircle } from "lucide-react"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "next-intl"
import {
  UpdateProvider,
  useAppUpdate,
} from "@/components/providers/update-provider"
import { StatusBarUpdate } from "@/components/layout/status-bar-update"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function SettingsAbout({ compact = false }: { compact?: boolean } = {}) {
  const t = useTranslations("Folder.sidebar.navigation")
  const update = useAppUpdate()
  const system = useTranslations("SystemSettings")
  const pending = useRef(false)
  const [acting, setActing] = useState(false)
  const ready = update?.state.status === "ready_to_restart"
  const busy =
    acting || update?.isBusy || update?.isUpdating || update?.checking
  if (!compact && !update) {
    return (
      <UpdateProvider>
        <SettingsAbout />
      </UpdateProvider>
    )
  }
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
  const statusLabel =
    update?.checking || acting
      ? system("checking")
      : update?.isUpdating
        ? system("downloading")
        : ready
          ? system("restartToUpdate")
          : update?.checkError
            ? system("checkUpdateFailed", { message: update.checkError })
            : update?.available
              ? system("foundUpdate", { version: update.available.version })
              : update?.lastCheckedAt
                ? system("alreadyLatest")
                : system("currentVersion")
  return (
    <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("about")}
            title={[t("about"), update?.currentVersion]
              .filter(Boolean)
              .join(" · ")}
            className="col-span-2 flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-sidebar-foreground hover:bg-interaction-hover hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="size-4" />
            {t("about")}
            {(update?.available ||
              update?.state.status === "ready_to_restart") && (
              <span
                data-version-update
                aria-hidden="true"
                className="ml-auto size-1.5 rounded-full bg-blue-500"
              />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-64 gap-3">
          <p className="font-semibold">{system("currentVersion")}</p>
          {update ? (
            <StatusBarUpdate />
          ) : (
            <UpdateProvider>
              <StatusBarUpdate />
            </UpdateProvider>
          )}
        </PopoverContent>
      </Popover>
      <div className="min-w-0 space-y-0.5 pl-3">
        <span
          title={update?.currentVersion || undefined}
          className="block truncate text-xs text-muted-foreground tabular-nums"
        >
          {update?.currentVersion || "—"}
        </span>
        <p
          role="status"
          title={statusLabel}
          className="line-clamp-2 text-2xs leading-relaxed text-muted-foreground"
        >
          {statusLabel}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={!update || !!busy}
        aria-busy={!!busy}
        onClick={async () => {
          if (!update || pending.current || busy) return
          pending.current = true
          setActing(true)
          try {
            await update.checkNow({ silent: false })
          } finally {
            pending.current = false
            setActing(false)
          }
        }}
        className="h-auto min-h-8 min-w-0 max-w-28 justify-self-end whitespace-normal py-1.5 text-xs"
      >
        {system(busy ? "checking" : "checkUpdate")}
      </Button>
    </div>
  )
}
