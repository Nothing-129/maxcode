"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import {
  ArrowLeft,
  Bot,
  FileSpreadsheet,
  GitBranch,
  Globe,
  Keyboard,
  Menu,
  Package,
  Search,
  MessageSquareText,
  SendHorizontal,
  Palette,
  Settings,
  SlidersHorizontal,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { usePathname } from "next/navigation"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AppToaster } from "@/components/ui/app-toaster"
import { cn } from "@/lib/utils"
import { detectEnvironment } from "@/lib/transport/detect"
import { AppTitleBar } from "@/components/layout/app-title-bar"
import { useIsMobile } from "@/hooks/use-mobile"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import {
  SETTINGS_SEARCH_ENTRIES,
  findSettingTarget,
  searchSettings,
  type SettingSearchResult,
} from "./settings-search"

interface SettingsNavItem {
  href: string
  labelKey:
    | "general"
    | "appearance"
    | "agents"
    | "skill_packs"
    | "quick_messages"
    | "shortcuts"
    | "version_control"
    | "chat_channels"
    | "system"
    | "web_service"
    | "logs"
  icon: ComponentType<{ className?: string }>
}

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    href: "/settings/appearance",
    labelKey: "appearance",
    icon: Palette,
  },
  {
    href: "/settings/general",
    labelKey: "general",
    icon: SlidersHorizontal,
  },
  {
    href: "/settings/agents",
    labelKey: "agents",
    icon: Bot,
  },
  {
    href: "/settings/skill-packs",
    labelKey: "skill_packs",
    icon: Package,
  },
  {
    href: "/settings/quick-messages",
    labelKey: "quick_messages",
    icon: MessageSquareText,
  },
  {
    href: "/settings/shortcuts",
    labelKey: "shortcuts",
    icon: Keyboard,
  },
  {
    href: "/settings/version-control",
    labelKey: "version_control",
    icon: GitBranch,
  },
  {
    href: "/settings/chat-channels",
    labelKey: "chat_channels",
    icon: SendHorizontal,
  },
  {
    href: "/settings/web-service",
    labelKey: "web_service",
    icon: Globe,
  },
  {
    href: "/settings/logs",
    labelKey: "logs",
    icon: FileSpreadsheet,
  },
  {
    href: "/settings/system",
    labelKey: "system",
    icon: Settings,
  },
]

interface SettingsShellProps {
  children: ReactNode
  activePath?: string
  onNavigate?: (href: string) => void
  onBack?: () => void
}

function normalizePath(path: string): string {
  const noSuffix = path.replace(/\/index\.html$/, "").replace(/\.html$/, "")
  const noTrailingSlash = noSuffix.replace(/\/+$/, "")
  return noTrailingSlash || "/"
}

function isWindowsRuntime(): boolean {
  if (typeof navigator === "undefined") return false
  const platform = navigator.platform.toLowerCase()
  const userAgent = navigator.userAgent.toLowerCase()
  return platform.includes("win") || userAgent.includes("windows")
}

export function SettingsShell({
  children,
  activePath,
  onNavigate,
  onBack,
}: SettingsShellProps) {
  const t = useTranslations("SettingsShell")
  const translate = useTranslations()
  const pathname = usePathname()
  const router = useRouter()
  const normalizedPathname = normalizePath(activePath ?? pathname)
  const isMobile = useIsMobile()
  const [navOpen, setNavOpen] = useState(false)
  const [query, setQuery] = useState("")
  const contentRef = useRef<HTMLDivElement>(null)
  const [searchTarget, setSearchTarget] = useState<{ id: string } | null>(
    () => {
      if (typeof window === "undefined") return null
      const id = new URLSearchParams(window.location.search).get("setting")
      return id ? { id } : null
    }
  )
  const [missingTarget, setMissingTarget] = useState<string | null>(null)
  const web = detectEnvironment() === "web"
  const visibleNavItems = SETTINGS_NAV_ITEMS.filter(
    (item) => !(item.labelKey === "web_service" && web)
  )
  const searchEntries = useMemo<SettingSearchResult[]>(() => {
    const navItems = SETTINGS_NAV_ITEMS.filter(
      (item) => !(item.labelKey === "web_service" && web)
    )
    const pages = navItems.map((item) => ({
      id: `page-${item.labelKey}`,
      page: item.href.split("/").pop()!,
      label: t(`nav.${item.labelKey}`),
      category: t(`nav.${item.labelKey}`),
      description: "",
    }))
    const settings = SETTINGS_SEARCH_ENTRIES.flatMap((entry) => {
      const category = navItems.find(
        (item) => item.href === `/settings/${entry.page}`
      )
      if (!category || (entry.desktopOnly && web)) return []
      return [
        {
          ...entry,
          label: entry.title ?? translate(entry.titleKey!),
          description: entry.descriptionKey
            ? translate(entry.descriptionKey)
            : "",
          category: t(`nav.${category.labelKey}`),
        },
      ]
    })
    return [...pages, ...settings]
  }, [t, translate, web])
  const results = searchSettings(searchEntries, query)

  useEffect(() => {
    const previous = document.title
    document.title = `${t("title")} - MaxCode`
    return () => {
      document.title = previous
    }
  }, [t])

  const navigateTo = useCallback(
    (href: string, settingId?: string) => {
      if (typeof window === "undefined") return
      setMissingTarget(null)
      setSearchTarget(settingId ? { id: settingId } : null)

      if (onNavigate) {
        onNavigate(href)
        setNavOpen(false)
        return
      }
      const target = normalizePath(href)
      const current = normalizePath(window.location.pathname)
      if (current === target) {
        setNavOpen(false)
        return
      }

      // Preserve query parameters when navigating between settings pages.
      const params = new URLSearchParams(window.location.search)
      if (settingId) params.set("setting", settingId)
      else params.delete("setting")
      const search = params.toString()
      const fullTarget = search ? `${target}?${search}` : target

      if (isWindowsRuntime()) {
        window.location.assign(fullTarget)
        return
      }

      router.push(fullTarget)
      setNavOpen(false)
    },
    [router, setNavOpen, onNavigate]
  )

  useEffect(() => {
    const root = contentRef.current
    const entry = searchEntries.find((item) => item.id === searchTarget?.id)
    if (
      !root ||
      !entry ||
      navOpen ||
      normalizedPathname !== `/settings/${entry.page}`
    )
      return
    let target: HTMLElement | null = null
    let oldTabIndex: string | null = null
    let highlightTimer: ReturnType<typeof setTimeout> | undefined
    const reveal = () => {
      if (target) return
      const found = findSettingTarget(root, entry)
      if (!found) return
      target = found
      observer.disconnect()
      clearTimeout(deadline)
      // These are navigation/disclosure controls only. Never activate a
      // setting's switch, submit button, or editable value while locating it.
      if (entry.agentType || entry.tab) found.click()
      found
        .querySelector<HTMLElement>(
          '[data-slot="collapsible-trigger"][data-state="closed"]'
        )
        ?.click()
      oldTabIndex = found.getAttribute("tabindex")
      found.setAttribute("tabindex", "-1")
      found.setAttribute("data-settings-search-highlight", "")
      found.scrollIntoView({ block: "center", behavior: "auto" })
      found.focus({ preventScroll: true })
      highlightTimer = setTimeout(
        () => found.removeAttribute("data-settings-search-highlight"),
        3000
      )
    }
    const observer = new MutationObserver(reveal)
    const deadline = setTimeout(() => {
      observer.disconnect()
      setMissingTarget(entry.id)
    }, 10000)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "inert", "data-state"],
    })
    // Wait until route changes and drawer focus restoration have committed.
    const frame = requestAnimationFrame(reveal)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(deadline)
      clearTimeout(highlightTimer)
      observer.disconnect()
      if (target) {
        target.removeAttribute("data-settings-search-highlight")
        if (oldTabIndex === null) target.removeAttribute("tabindex")
        else target.setAttribute("tabindex", oldTabIndex)
      }
    }
  }, [searchTarget, searchEntries, normalizedPathname, navOpen])

  const openResult = (result: SettingSearchResult) => {
    navigateTo(`/settings/${result.page}`, result.id)
  }

  const navContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-2 pb-3 text-lg font-semibold">{t("title")}</div>
      <label className="settings-search">
        <Search aria-hidden="true" className="size-3.5" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === "Escape" && query) {
              event.preventDefault()
              event.stopPropagation()
              setQuery("")
            } else if (event.key === "Enter" && results[0]) {
              event.preventDefault()
              openResult(results[0])
            }
          }}
          placeholder={t("searchSettings")}
          aria-label={t("searchSettings")}
        />
      </label>
      <div className="px-2 pb-2 text-xs text-muted-foreground">
        {query.trim()
          ? t("searchResults", { count: results.length })
          : t("preferences")}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="space-y-0.5">
          {query.trim() ? (
            results.length ? (
              results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => openResult(result)}
                  className="flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="text-sm font-medium">{result.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {result.category}
                  </span>
                  {result.description && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {result.description}
                    </span>
                  )}
                </button>
              ))
            ) : (
              <p
                role="status"
                className="px-2 py-4 text-sm text-muted-foreground"
              >
                {t("searchEmpty")}
              </p>
            )
          ) : (
            visibleNavItems.map((item) => {
              const Icon = item.icon
              const translationKey = `nav.${item.labelKey}` as const
              const active =
                normalizedPathname === item.href ||
                normalizedPathname.startsWith(`${item.href}/`)
              return (
                <Button
                  key={item.href}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-[1.875rem] w-full justify-start rounded-lg px-2 text-sm font-normal"
                  )}
                  type="button"
                  onClick={() => navigateTo(item.href)}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Icon className="h-3.5 w-3.5" />
                    {t(translationKey)}
                  </span>
                </Button>
              )
            })
          )}
        </nav>
      </ScrollArea>
    </div>
  )

  return (
    <div
      data-settings-surface=""
      className="h-screen flex flex-col overflow-hidden bg-background text-foreground"
    >
      {onBack ? (
        <div data-drag-region className="h-10 shrink-0 settings-drag-strip" />
      ) : (
        <AppTitleBar
          left={
            isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={t("title")}
                onClick={() => setNavOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </Button>
            ) : undefined
          }
          center={
            <div className="text-sm font-bold tracking-tight">{t("title")}</div>
          }
        />
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Desktop sidebar */}
        {!isMobile && (
          <aside
            className={cn(
              "flex min-h-0 w-[17.75rem] shrink-0 flex-col border-r border-border/60 bg-sidebar px-2 py-3"
            )}
          >
            {onBack && (
              <Button
                variant="ghost"
                className="mb-4 justify-start gap-2 px-2 text-[0.8125rem]"
                onClick={onBack}
              >
                <ArrowLeft className="size-4" />
                {t("backToApp")}
              </Button>
            )}
            {navContent}
          </aside>
        )}

        {/* Mobile navigation Drawer. Opts back into press-outside-to-close,
            against the app-wide drawer default: it is navigation, and tapping
            the page it partially covers is how you put it away on a phone. */}
        {isMobile && (
          <Drawer
            open={navOpen}
            onOpenChange={setNavOpen}
            swipeDirection="left"
            disablePointerDismissal={false}
          >
            {/* rem so the nav grows with the zoom level like its own labels do,
                but capped against the viewport: 16.25rem at 150% is 390px, wider
                than the phone this drawer is for. */}
            <DrawerContent
              showCloseButton={false}
              className="w-[min(16.25rem,85vw)] p-3"
            >
              <DrawerTitle className="sr-only">{t("title")}</DrawerTitle>
              {navContent}
            </DrawerContent>
          </Drawer>
        )}

        <section className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
          {onBack && isMobile && (
            <div className="flex shrink-0 items-center justify-between px-2">
              <Button variant="ghost" onClick={onBack}>
                <ArrowLeft className="size-4" />
                {t("backToApp")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("title")}
                onClick={() => setNavOpen(true)}
              >
                <Menu className="size-4" />
              </Button>
            </div>
          )}
          {missingTarget === searchTarget?.id && (
            <p
              role="status"
              className="px-4 py-2 text-sm text-muted-foreground"
            >
              {t("searchTargetUnavailable")}
            </p>
          )}
          <div
            ref={contentRef}
            className={cn(
              "settings-content min-h-0 w-full flex-1",
              onBack && "pt-0"
            )}
          >
            {children}
          </div>
        </section>
      </div>
      <AppToaster position="bottom-right" closeButton duration={4000} />
    </div>
  )
}
