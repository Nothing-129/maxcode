"use client"

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useTranslations } from "next-intl"
import {
  OPEN_IN_APP_SETTINGS_EVENT,
  type InAppSettingsRequest,
} from "@/lib/in-app-settings"
import { SettingsShell } from "./settings-shell"

const pages = {
  general: lazy(() => import("@/app/settings/general/page")),
  appearance: lazy(() => import("@/app/settings/appearance/page")),
  agents: lazy(() => import("@/app/settings/agents/page")),
  "model-providers": lazy(() => import("@/app/settings/model-providers/page")),
  mcp: lazy(() => import("@/app/settings/mcp/page")),
  skills: lazy(() => import("@/app/settings/skills/page")),
  "skill-packs": lazy(() => import("@/app/settings/skill-packs/page")),
  "quick-messages": lazy(() => import("@/app/settings/quick-messages/page")),
  shortcuts: lazy(() => import("@/app/settings/shortcuts/page")),
  "version-control": lazy(() => import("@/app/settings/version-control/page")),
  "chat-channels": lazy(() => import("@/app/settings/chat-channels/page")),
  "web-service": lazy(() => import("@/app/settings/web-service/page")),
  logs: lazy(() => import("@/app/settings/logs/page")),
  system: lazy(() => import("@/app/settings/system/page")),
}

/** Keep the workspace mounted so returning preserves drafts, scroll and sessions. */
export function InAppSettings({ children }: { children: ReactNode }) {
  const t = useTranslations("SettingsShell")
  const [visited, setVisited] = useState<Array<keyof typeof pages>>([])
  const [section, setSection] = useState<keyof typeof pages | null>(null)
  const navigate = useCallback((next: keyof typeof pages) => {
    setVisited((current) =>
      current.includes(next) ? current : [...current, next]
    )
    setSection(next)
  }, [])
  const returnUrl = useRef<string | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const close = useCallback(() => {
    setSection(null)
    setVisited([])
    if (returnUrl.current)
      window.history.replaceState(null, "", returnUrl.current)
    returnUrl.current = null
    requestAnimationFrame(() => returnFocus.current?.focus())
  }, [])
  useEffect(() => {
    const open = (event: Event) => {
      const { detail } = event as CustomEvent<InAppSettingsRequest>
      event.preventDefault()
      if (!returnUrl.current) {
        returnUrl.current = window.location.href
        returnFocus.current = document.activeElement as HTMLElement | null
      }
      const target = detail.section ?? "general"
      const aliases = ["experts", "science", "office-tools"]
      const url = new URL(window.location.href)
      if (detail.agentType) url.searchParams.set("agent", detail.agentType)
      if (aliases.includes(target))
        url.searchParams.set(
          "tab",
          target === "office-tools" ? "office" : target
        )
      window.history.replaceState(null, "", url)
      navigate(
        aliases.includes(target)
          ? "skill-packs"
          : target in pages
            ? (target as keyof typeof pages)
            : "general"
      )
    }
    window.addEventListener(OPEN_IN_APP_SETTINGS_EVENT, open)
    return () => window.removeEventListener(OPEN_IN_APP_SETTINGS_EVENT, open)
  }, [navigate])
  return (
    <>
      <div
        className="h-full min-h-0"
        hidden={section !== null}
        inert={section !== null}
      >
        {children}
      </div>
      {section && (
        <div
          className="fixed inset-0 z-[100] bg-background"
          data-in-app-settings=""
        >
          <SettingsShell
            activePath={`/settings/${section}`}
            onBack={close}
            onNavigate={(href) => {
              const next = href.split("/").pop() ?? "general"
              if (next in pages) navigate(next as keyof typeof pages)
            }}
          >
            {visited.map((key) => {
              const Page = pages[key]
              return (
                <div
                  key={key}
                  className="h-full min-h-0"
                  hidden={key !== section}
                  inert={key !== section}
                >
                  <Suspense
                    fallback={
                      <div
                        role="status"
                        className="p-6 text-sm text-muted-foreground"
                      >
                        {t("loading")}
                      </div>
                    }
                  >
                    <Page />
                  </Suspense>
                </div>
              )
            })}
          </SettingsShell>
        </div>
      )}
    </>
  )
}
