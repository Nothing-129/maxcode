"use client"

import { SettingsHelp } from "@/components/shared/settings-help"
import { useCallback, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { FolderOpen, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExpertsBody } from "@/components/settings/experts-settings"
import { ScienceBody } from "@/components/settings/science-settings"
import { OfficeToolsBody } from "@/components/settings/office-tools-settings"
import { CustomSkillsBody } from "@/components/settings/custom-skills-settings"
import { expertsOpenCentralDir, openFolder } from "@/lib/api"
import { isLocalDesktop, revealItemInDir } from "@/lib/platform"
import { toErrorMessage } from "@/lib/app-error"

type SkillPackTab = "experts" | "science" | "office" | "custom"

function normalizeTab(raw: string | null): SkillPackTab {
  if (
    raw === "experts" ||
    raw === "science" ||
    raw === "office" ||
    raw === "custom"
  ) {
    return raw
  }
  return "office"
}

/**
 * Unified "Skill Packs" settings hub — a shared generic header + a fixed
 * top-right toolbar over a tabbed switcher for the three curated,
 * codeg-managed skill bundles (Experts, Science, Office). Each tab renders the
 * existing per-pack body verbatim.
 */
export function SkillPacksSettings() {
  const t = useTranslations("SkillPacksSettings")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Local state is the visual source of truth so the tab always switches (even
  // on the Windows hard-nav runtime); the `?tab=` param is a best-effort mirror
  // for deep-linking, seeded once from the URL.
  const [tab, setTab] = useState<SkillPackTab>(() =>
    normalizeTab(searchParams.get("tab"))
  )
  const activeTabRef = useRef(tab)

  // The currently-mounted pack body publishes its reload handler here, so the
  // fixed "Refresh" button drives whichever tab is visible without remounting
  // it (which would tear down Office's in-flight install stream). Exactly one
  // body is mounted at a time, so the last registration always wins.
  const activeRefreshRef = useRef<(() => void) | null>(null)
  const registerRefresh = useCallback((fn: () => void) => {
    activeRefreshRef.current = fn
  }, [])

  const handleTabChange = useCallback(
    (next: string) => {
      const value = normalizeTab(next)
      // Focus and pointer activation can report the same selection before
      // React commits it. Mirror each actual change into the URL only once.
      if (value === activeTabRef.current) return
      activeTabRef.current = value
      setTab(value)
      // Preserve every other param (esp. ?remoteConnectionId=N) when mirroring
      // the active tab into the URL.
      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", value)
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  // All three packs link from ONE shared central store (~/.codeg/skills), so a
  // single, tab-independent "open central folder" is correct for every tab.
  const handleOpenCentralDir = useCallback(async () => {
    try {
      const path = await expertsOpenCentralDir()
      if (isLocalDesktop()) {
        // Desktop: reveal the folder. `revealItemInDir` (not `openPath`) is
        // deliberate — the opener plugin's scope rejects `openPath` for the
        // hidden `~/.codeg/...` path.
        await revealItemInDir(path)
      } else {
        await openFolder(path)
      }
    } catch (err) {
      toast.error(t("toasts.openFolderFailed"), {
        description: toErrorMessage(err),
      })
    }
  }, [t])

  return (
    <div data-settings-page="wide" className="h-full flex flex-col p-3 md:p-4">
      <div className="shrink-0 pb-4">
        <div className="settings-help-heading flex items-center gap-1">
          <h1 data-settings-page-title="">{t("title")}</h1>
          <SettingsHelp label={t("title")}>{t("description")}</SettingsHelp>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        className="flex flex-col flex-1 min-h-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 shrink-0 border-y py-2">
          <TabsList variant="line" className="max-w-full">
            <TabsTrigger value="experts">{t("tabs.experts")}</TabsTrigger>
            <TabsTrigger value="science">{t("tabs.science")}</TabsTrigger>
            <TabsTrigger value="office">{t("tabs.office")}</TabsTrigger>
            <TabsTrigger value="custom">{t("tabs.custom")}</TabsTrigger>
          </TabsList>

          {/* Fixed toolbar — identical on every tab. */}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                handleOpenCentralDir().catch((err) => {
                  console.error(
                    "[SkillPacksSettings] open central dir failed:",
                    err
                  )
                })
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {t("actions.openCentralDir")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => activeRefreshRef.current?.()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("actions.refresh")}
            </Button>
          </div>
        </div>

        <TabsContent
          value="experts"
          className="mt-0 flex-1 min-h-0 flex flex-col"
        >
          <ExpertsBody onRegisterRefresh={registerRefresh} />
        </TabsContent>
        <TabsContent
          value="science"
          className="mt-0 flex-1 min-h-0 flex flex-col"
        >
          <ScienceBody onRegisterRefresh={registerRefresh} />
        </TabsContent>
        <TabsContent
          value="office"
          className="mt-0 flex-1 min-h-0 flex flex-col"
        >
          <OfficeToolsBody onRegisterRefresh={registerRefresh} />
        </TabsContent>
        <TabsContent
          value="custom"
          className="mt-0 flex-1 min-h-0 flex flex-col"
        >
          <CustomSkillsBody onRegisterRefresh={registerRefresh} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
