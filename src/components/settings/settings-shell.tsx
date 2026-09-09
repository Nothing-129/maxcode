"use client"

import {
  useCallback,
  useEffect,
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

interface SettingsNavItem {
  href: string
  labelKey:
    | "general"
    | "appearance"
    | "agents"
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
  const pathname = usePathname()
  const router = useRouter()
  const normalizedPathname = normalizePath(activePath ?? pathname)
  const isMobile = useIsMobile()
  const [navOpen, setNavOpen] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    const previous = document.title
    document.title = `${t("title")} - MaxCode`
    return () => {
      document.title = previous
    }
  }, [t])

  const navigateTo = useCallback(
    (href: string) => {
      if (typeof window === "undefined") return

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

      // Preserve current query string so the active remote workspace context
      // (`?remoteConnectionId=N`) carries over to sub-pages — without this,
      // navigating from /settings/appearance to /settings/mcp drops the
      // remote id and the next page falls back to the local Tauri backend.
      const search = window.location.search
      const fullTarget = search ? `${target}${search}` : target

      if (isWindowsRuntime()) {
        window.location.assign(fullTarget)
        return
      }

      router.push(fullTarget)
      setNavOpen(false)
    },
    [router, setNavOpen, onNavigate]
  )

  const filteredNavItems = SETTINGS_NAV_ITEMS.filter(
    (item) =>
      !(item.labelKey === "web_service" && detectEnvironment() === "web") &&
      t(`nav.${item.labelKey}`)
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
  )

  const navContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="settings-search">
        <Search aria-hidden="true" className="size-3.5" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchSettings")}
          aria-label={t("searchSettings")}
        />
      </label>
      <div className="px-2 pb-2 text-xs text-muted-foreground">
        {t("preferences")}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="space-y-1">
          {filteredNavItems.map((item) => {
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
          })}
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
        <div
          data-tauri-drag-region
          className="h-10 shrink-0 settings-drag-strip"
        />
      ) : (
        <AppTitleBar
          left={
            isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
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
              "flex min-h-0 shrink-0 flex-col px-2 py-3",
              onBack ? "w-[16.75rem] bg-sidebar" : "w-56 border-r"
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
          <div
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
