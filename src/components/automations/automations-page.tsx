"use client"

import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { AutomationSidebarHost } from "./automation-sidebar-host"
import { Input } from "@/components/ui/input"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  ArrowLeft,
  CalendarClock,
  Clock,
  ChevronRight,
  CirclePlay,
  Search,
  Folder,
  GitBranch,
  ListFilter,
  Loader2,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  Play,
  Plus,
  Power,
  PowerOff,
  RotateCw,
  SlidersHorizontal,
  SquareArrowOutUpRight,
  SquareKanban,
  Trash2,
  X,
  Zap,
} from "lucide-react"
import { useAutomationsView } from "@/contexts/automations-view-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useTabActions } from "@/contexts/tab-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { MessageListenerPanel } from "./message-listener-panel"
import { AutomationEditor } from "./automation-editor"
import {
  templateToDraft,
  type AutomationTemplate,
} from "./automation-templates"
import { TemplateGallery } from "./template-gallery"
import {
  AutomationPrompt,
  DetailDisclosure,
  maskAutomationText,
} from "./automation-detail-disclosures"
import { ScheduleLabel } from "./schedule-label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AgentIcon } from "@/components/agent-icon"
import { WorkbenchPageTitle } from "@/components/workbench/workbench-page-title"
import {
  FolderSelect,
  type FolderSelectOption,
} from "@/components/shared/folder-select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  automationCancelRun,
  automationCreate,
  automationDelete,
  automationMarkSeen,
  automationRunNow,
  getFolderConversation,
  automationRuns,
  automationSetEnabled,
  automationUpdate,
} from "@/lib/api"
import {
  isNativeDesktop,
  onTransportReconnect,
  subscribe,
} from "@/lib/platform"
import { cn } from "@/lib/utils"
import type { Automation, AutomationDraft, AutomationRun } from "@/lib/types"
import { useAgentVocabulary } from "@/hooks/use-agent-vocabulary"

import { MAC_TRAFFIC_LIGHT_INSET } from "@/lib/window-chrome"
import { usePlatform } from "@/hooks/use-platform"
import { useIsMobile } from "@/hooks/use-mobile"

const AUTOMATION_CHANGED_EVENT = "automation://changed"

const STATUS_STYLES: Record<string, string> = {
  running: "bg-primary/10 text-primary",
  succeeded: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  skipped: "bg-muted text-muted-foreground",
}

function StatusChip({ status }: { status: string | null }) {
  const t = useTranslations("Automations")
  if (!status) return null
  const label =
    {
      running: t("statusRunning"),
      succeeded: t("statusSucceeded"),
      failed: t("statusFailed"),
      cancelled: t("statusCancelled"),
      skipped: t("statusSkipped"),
    }[status] ?? status
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[0.6875rem] font-medium",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {label}
    </span>
  )
}

function nextRunLabel(iso: string, now: number, locale: string) {
  const delta = Date.parse(iso) - now
  if (!Number.isFinite(delta)) return "—"
  const minutes = Math.max(1, Math.round(delta / 60000))
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  if (minutes < 60) return format.format(minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (hours < 24) return format.format(hours, "hour")
  return format.format(Math.round(hours / 24), "day")
}

function formatDuration(
  startIso: string | null,
  endIso: string | null
): string {
  if (!startIso || !endIso) return "—"
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—"
  const sec = Math.round((end - start) / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

// Absolute local date-time for run-history rows; null/invalid → "—".
function formatDateTime(
  iso: string | null,
  locale: string,
  now: number
): string {
  if (!iso) return "—"
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return "—"
  const date = new Date(ts)
  const today = new Date(now)
  return date.toLocaleString(locale, {
    ...(today.toDateString() === date.toDateString()
      ? {}
      : { month: "short", day: "numeric" }),
    ...(today.getFullYear() === date.getFullYear() ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** The detail pane's three states. "gallery" is the template picker shown when
 *  starting a new automation; "editor" hosts the form, seeded from a template
 *  (create) or an existing automation (edit). */
type EditingState =
  | { kind: "create"; seed: AutomationDraft | null }
  | { kind: "edit"; automation: Automation }

/** Page title rendered into the window-chrome strip above the page (the h-10
 *  band shared with the fixed corner overlays) — the shared breadcrumb header,
 *  so all three workbench routes open with an identical header rhythm and the
 *  same way back to the conversation workspace. */
export function AutomationsPageTitle() {
  const t = useTranslations("Automations")
  return <WorkbenchPageTitle title={t("title")} />
}

export function AutomationsPage() {
  const t = useTranslations("Automations")
  const { automations, unseenFailures, refetch } = useAutomationsView()
  const folders = useAppWorkspaceStore((s) => s.folders)
  const isMobile = useIsMobile()
  const { isMac } = usePlatform()
  const sidebarHost = useContext(AutomationSidebarHost)
  const searchToggleRef = useRef<HTMLButtonElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [expandedGroups, setExpandedGroups] = useState({
    enabled: true,
    paused: false,
  })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [mode, setMode] = useState<"detail" | "gallery" | "editor">("detail")
  const [editing, setEditing] = useState<EditingState | null>(null)

  // Clear the unseen-failure badges while the page is open — on entry and again
  // whenever a new failure arrives live (the failed run is already on screen, so
  // the sidebar badge shouldn't keep nagging). Keying on unseenFailures rather
  // than mount makes it re-fire on the automation://changed refetch; it
  // converges because markSeen drives the count to 0, after which this early
  // returns. refetch is stable.
  useEffect(() => {
    if (unseenFailures === 0) return
    void automationMarkSeen()
      .then(() => refetch())
      .catch(() => {})
  }, [unseenFailures, refetch])

  const hasAutomations = automations.length > 0
  // The shown automation: the explicit selection, else the first row, so the
  // detail pane is never blank when automations exist. Derived (no effect) so a
  // deleted selection cleanly falls back instead of dangling.
  const current =
    automations.find((a) => a.id === selectedId) ?? automations[0] ?? null
  // Frozen at mount — the page remounts on each route entry, so relative labels
  // ("Next in 3h") are anchored to when Automations was opened. Reading Date.now
  // during render is impure (react-hooks/purity); this is the RunHistory idiom.
  const [now] = useState(() => Date.now())

  // List filters (folder + enabled state), ephemeral per page mount.
  const [folderFilter, setFolderFilter] = useState<number | "all">("all")
  const [statusFilter, setStatusFilter] = useState<
    "all" | "enabled" | "disabled"
  >("all")
  // Folder options: the workspace's project folders (same set the Tasks board
  // filters by), plus any other folder an automation actually targets — the
  // editor lets a launch_session run point at a worktree subfolder, which is
  // not a project folder but must still be filterable.
  const folderOptions = useMemo(() => {
    const options = new Map<number, FolderSelectOption>()
    for (const f of folders) {
      if (f.parent_id == null && f.kind === "regular")
        options.set(f.id, {
          id: f.id,
          name: f.name,
          alias: f.alias,
          path: f.path,
        })
    }
    const byId = new Map(folders.map((f) => [f.id, f]))
    for (const a of automations) {
      if (a.root_folder_id == null || options.has(a.root_folder_id)) continue
      const known = byId.get(a.root_folder_id)
      options.set(a.root_folder_id, {
        id: a.root_folder_id,
        // A folder the workspace no longer lists is still filterable — by the
        // only handle left, its id.
        name: known?.name ?? `#${a.root_folder_id}`,
        alias: known?.alias ?? null,
        path: known?.path ?? null,
      })
    }
    // Sorted by what the row leads with, so the list reads in the order it looks.
    return [...options.values()].sort((a, b) =>
      (a.alias ?? a.name).localeCompare(b.alias ?? b.name)
    )
  }, [automations, folders])
  // Deleting the last automation of a folder strands the filter on an option
  // that no longer exists. Fall back to "all" by derivation (no effect) so the
  // pill never renders blank over an empty list.
  const activeFolderFilter =
    folderFilter !== "all" && !folderOptions.some((f) => f.id === folderFilter)
      ? "all"
      : folderFilter
  const visibleAutomations = useMemo(
    () =>
      automations.filter(
        (a) =>
          a.name
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase()) &&
          (activeFolderFilter === "all" ||
            a.root_folder_id === activeFolderFilter) &&
          (statusFilter === "all" ||
            (statusFilter === "enabled" ? a.enabled : !a.enabled))
      ),
    [automations, activeFolderFilter, statusFilter, search]
  )

  const openGallery = () => {
    setEditing(null)
    setMode("gallery")
  }
  const backToGallery = () => {
    setEditing(null)
    setMode("gallery")
  }
  const closeToDetail = () => {
    setEditing(null)
    setMode("detail")
  }
  const pickTemplate = (tpl: AutomationTemplate | null) => {
    const seed = tpl
      ? templateToDraft(tpl, {
          name: t(tpl.titleKey),
          agentType: "claude_code",
          folderId: folders[0]?.id ?? null,
        })
      : null
    setEditing({ kind: "create", seed })
    setMode("editor")
  }
  const startEdit = (a: Automation) => {
    setEditing({ kind: "edit", automation: a })
    setMode("editor")
  }
  const selectAutomation = (a: Automation) => {
    setMobileDetailOpen(true)
    setSelectedId(a.id)
    setEditing(null)
    setMode("detail")
  }

  // Shared mutation runner for the per-row quick actions (run now / toggle /
  // delete) hoisted out of the detail pane so the list's ⋯ menu can drive them.
  const runAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn()
        await refetch()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      }
    },
    [refetch]
  )

  const handleSubmit = async (draft: AutomationDraft) => {
    const saved =
      editing?.kind === "edit"
        ? await automationUpdate(editing.automation.id, draft)
        : await automationCreate(draft)
    await refetch()
    await useAppWorkspaceStore.getState().refreshConversations()
    setMobileDetailOpen(true)
    setSelectedId(saved.id)
    closeToDetail()
  }

  const editorPane =
    editing != null ? (
      <ScrollArea className="h-full">
        {/* PANEL_PAD everywhere inside a panel — the pane used to jump from
            p-4 to p-6 at the sm breakpoint while the panel's own margins
            didn't, which read as inconsistent gutters. */}
        <div className="mx-auto w-full max-w-2xl p-4">
          <AutomationEditor
            // Key by edit target so switching to a different automation (e.g.
            // ⋯ → Edit on another row while the editor is open) remounts with
            // fresh state instead of showing the previous target's fields.
            key={
              editing.kind === "edit"
                ? `edit-${editing.automation.id}`
                : "create"
            }
            automation={
              editing.kind === "edit" ? editing.automation : editing.seed
            }
            onSubmit={handleSubmit}
            onCancel={closeToDetail}
            onBackToTemplates={
              editing.kind === "create" ? backToGallery : undefined
            }
          />
        </div>
      </ScrollArea>
    ) : null

  const picker = (onboarding: boolean) => (
    <ScrollArea className="h-full">
      {/* Onboarding is the whole page, so the gallery is centered in the shell
          both ways. Vertical centering rides on `my-auto` inside a
          `min-h-full` column rather than `justify-center`: when the gallery is
          taller than the viewport the free space goes negative, auto margins
          collapse to 0, and it scrolls from the top instead of having its head
          clipped out of reach. */}
      <div className="flex min-h-full flex-col">
        <div
          className={cn(
            "mx-auto flex w-full max-w-4xl flex-col gap-6 p-4",
            onboarding && "my-auto"
          )}
        >
          {onboarding ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Zap className="size-6" aria-hidden="true" />
              </span>
              <h2 className="text-base font-semibold">{t("onboardTitle")}</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {t("onboardHint")}
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("startFromTemplate")}
              </h2>
              <Button size="sm" variant="ghost" onClick={closeToDetail}>
                {t("cancel")}
              </Button>
            </div>
          )}
          <TemplateGallery onPick={pickTemplate} />
        </div>
      </div>
    </ScrollArea>
  )

  const listPane = (
    <aside
      aria-label={t("title")}
      className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--conversation-sidebar)] ws-transparent-bg text-sidebar-foreground"
    >
      <div
        data-drag-region
        style={
          !isMobile && isMac && isNativeDesktop()
            ? {
                paddingLeft: `max(0.75rem, calc(${MAC_TRAFFIC_LIGHT_INSET}px - 3.5rem + 0.25rem))`,
              }
            : undefined
        }
        className="flex h-12 shrink-0 items-center gap-1 px-3"
      >
        <h2 className="min-w-0 flex-1 truncate ps-1 text-base font-semibold">
          {t("title")}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("filterAutomations")}
          title={t("filterAutomations")}
          aria-expanded={filtersOpen}
          className={cn(
            "text-muted-foreground",
            (activeFolderFilter !== "all" || statusFilter !== "all") &&
              "bg-muted text-foreground"
          )}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <ListFilter className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          ref={searchToggleRef}
          aria-label={t("searchAutomations")}
          title={t("searchAutomations")}
          aria-expanded={searchOpen}
          onClick={() => {
            setSearchOpen(!searchOpen)
            if (searchOpen) setSearch("")
          }}
        >
          <Search className="size-4 text-muted-foreground" />
        </Button>
      </div>
      {searchOpen && (
        <div className="px-3 pb-2">
          <Input
            autoFocus
            type="search"
            value={search}
            aria-label={t("searchAutomations")}
            placeholder={t("searchAutomations")}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearch("")
                setSearchOpen(false)
                searchToggleRef.current?.focus()
              }
            }}
            className="h-8 rounded-md bg-background/70 text-xs md:text-xs"
          />
        </div>
      )}
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
          <FolderSelect
            folders={folderOptions}
            value={activeFolderFilter === "all" ? null : activeFolderFilter}
            onChange={setFolderFilter}
            allLabel={t("allFolders")}
            onSelectAll={() => setFolderFilter("all")}
            variant="ghost"
            className="h-8 max-w-full rounded-md px-2 text-xs"
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("filterAutomations")}
              className="rounded-md border-transparent bg-transparent px-2 text-xs hover:bg-muted"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAll")}</SelectItem>
              <SelectItem value="enabled">{t("enabled")}</SelectItem>
              <SelectItem value="disabled">{t("statusDisabled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="px-2 pb-2">
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start gap-2 px-2 text-[0.8125rem] font-semibold"
          disabled={mode !== "detail"}
          onClick={openGallery}
        >
          <Plus className="size-4" />
          {t("new")}
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {visibleAutomations.length === 0 && hasAutomations && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {t("noMatches")}
          </p>
        )}
        {[true, false].map((enabled) => {
          const items = visibleAutomations.filter((a) => a.enabled === enabled)
          if (!items.length) return null
          const group = enabled ? "enabled" : "paused"
          const expanded = expandedGroups[group]
          return (
            <section key={group} className="px-2 pb-4">
              <h3>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() =>
                    setExpandedGroups((groups) => ({
                      ...groups,
                      [group]: !groups[group],
                    }))
                  }
                  className="group flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-xs leading-5 font-normal text-sidebar-foreground/50 select-none hover:text-sidebar-foreground/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                >
                  <span>{enabled ? t("groupEnabled") : t("groupPaused")}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      "maxcode-disclosure-chevron size-3 shrink-0 transition-[transform,opacity] duration-200 ease-out",
                      expanded &&
                        "rotate-90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    )}
                  />
                </button>
              </h3>
              {expanded && (
                <ul className="flex flex-col gap-0.5 ps-2">
                  {items.map((a) => (
                    <AutomationListItem
                      key={a.id}
                      automation={a}
                      now={now}
                      selected={mode === "detail" && current?.id === a.id}
                      onSelect={() => selectAutomation(a)}
                      onRunNow={() => runAction(() => automationRunNow(a.id))}
                      onToggleEnabled={() =>
                        runAction(() => automationSetEnabled(a.id, !a.enabled))
                      }
                      onEdit={() => startEdit(a)}
                      onDelete={() => runAction(() => automationDelete(a.id))}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </ScrollArea>
    </aside>
  )
  const detailPane = (
    <div className="h-full min-w-0">
      {mode === "editor" && editing ? (
        editorPane
      ) : mode === "gallery" ? (
        picker(false)
      ) : current ? (
        <AutomationDetail
          key={current.id}
          now={now}
          automation={current}
          refetch={refetch}
          onEdit={() => startEdit(current)}
        />
      ) : (
        // Defensive only: `current` falls back to automations[0],
        // which is always present inside this hasAutomations
        // branch, so this arm is not reached in practice.
        <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
          {t("selectHint")}
        </div>
      )}
    </div>
  )
  const showMobileDetail = mobileDetailOpen || mode !== "detail"

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!isMobile && sidebarHost && createPortal(listPane, sidebarHost)}
      {isMobile && hasAutomations && showMobileDetail && (
        <div className="shrink-0 border-b border-border/50 px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              closeToDetail()
              setMobileDetailOpen(false)
            }}
          >
            <ArrowLeft className="size-4" />
            {t("title")}
          </Button>
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        {!hasAutomations
          ? mode === "editor" && editing
            ? editorPane
            : picker(mode !== "gallery")
          : isMobile && !showMobileDetail
            ? listPane
            : detailPane}
      </div>
    </div>
  )
}

function AutomationListItem({
  automation,
  now,
  selected,
  onSelect,
  onRunNow,
  onToggleEnabled,
  onEdit,
  onDelete,
}: {
  automation: Automation
  now: number
  selected: boolean
  onSelect: () => void
  onRunNow: () => void
  onToggleEnabled: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const t = useTranslations("Automations")
  const locale = useLocale()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const failed = automation.enabled && automation.last_run_status === "failed"

  function rowSubtitle() {
    if (automation.last_run_status === "running") return t("statusRunning")
    if (!automation.enabled) return null
    if (failed) return t("statusFailed")
    if (automation.trigger_kind === "schedule") {
      return automation.next_run_at
        ? nextRunLabel(automation.next_run_at, now, locale)
        : t("triggerSchedule")
    }
    return t(
      automation.trigger_kind === "message" ? "triggerMessage" : "manual"
    )
  }

  const subtitle = rowSubtitle()

  // The row's quick actions, authored once so the ⋯ dropdown and the right-click
  // context menu render exactly the same set (the user asked for parity).
  const actions: Array<{
    key: string
    icon: React.ReactNode
    label: string
    onSelect: () => void
    variant?: "destructive"
    separatorBefore?: boolean
  }> = [
    {
      key: "run",
      icon: <Play className="size-3.5" aria-hidden="true" />,
      label: t("runNow"),
      onSelect: onRunNow,
    },
    {
      key: "toggle",
      icon: automation.enabled ? (
        <PowerOff className="size-3.5" aria-hidden="true" />
      ) : (
        <Power className="size-3.5" aria-hidden="true" />
      ),
      label: automation.enabled ? t("disable") : t("enable"),
      onSelect: onToggleEnabled,
    },
    {
      key: "edit",
      icon: <Pencil className="size-3.5" aria-hidden="true" />,
      label: t("edit"),
      onSelect: onEdit,
    },
    {
      key: "delete",
      icon: <Trash2 className="size-3.5" aria-hidden="true" />,
      label: t("delete"),
      // Let the menu close (and restore focus) before the dialog mounts —
      // opening synchronously races focus restoration and self-dismisses.
      onSelect: () => setTimeout(() => setConfirmOpen(true), 0),
      variant: "destructive",
      separatorBefore: true,
    },
  ]

  // Render the shared actions into either menu's item/separator components.
  const renderActions = (
    Item: React.ElementType,
    Separator: React.ElementType
  ) =>
    actions.map((a) => (
      <Fragment key={a.key}>
        {a.separatorBefore ? <Separator /> : null}
        <Item variant={a.variant} onSelect={a.onSelect}>
          {a.icon}
          {a.label}
        </Item>
      </Fragment>
    ))

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group flex w-full items-center rounded-[0.625rem] transition-colors",
              selected
                ? "bg-[#eaeaea] dark:bg-white/[0.1]"
                : "hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
            )}
          >
            <button
              type="button"
              onClick={onSelect}
              aria-current={selected ? "true" : undefined}
              className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-[0.625rem] px-2 py-1.5 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <span className="truncate text-[0.8125rem] leading-5">
                {automation.name}
              </span>
              {subtitle && (
                <span
                  className={cn(
                    "truncate text-xs leading-4",
                    failed ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {subtitle}
                </span>
              )}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="me-1 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
                  aria-label={t("moreActions")}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {renderActions(DropdownMenuItem, DropdownMenuSeparator)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        {/* Right-click anywhere on the row opens the same actions as ⋯. */}
        <ContextMenuContent className="w-40">
          {renderActions(ContextMenuItem, ContextMenuSeparator)}
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

// One fact — icon + uppercase label on top, value below. Deliberately NOT a
// card: these live inside the overview Section, and boxing each of six
// facts inside an already-boxed section read as card-in-card confetti. Grid
// spacing alone separates them.
function StatItem({
  icon,
  label,
  children,
  className,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-center gap-1.5 text-muted-foreground [&>svg]:size-3.5">
        {icon}
        <span className="text-[0.6875rem] font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  )
}

/**
 * A titled block inside the detail panel. Deliberately NOT a card: the panel
 * already draws the outer boundary, so boxing each block again would stack
 * three borders (panel → card → stat). A rule above the title carries the
 * separation instead; the top rule doubles as the divider from the block above.
 */
function Section({
  title,
  action,
  children,
}: {
  title: string
  /** Optional trailing control on the title row (e.g. run history's refresh). */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border ws-chrome-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function AutomationDetail({
  now,
  automation,
  refetch,
  onEdit,
}: {
  now: number
  automation: Automation
  refetch: () => Promise<void>
  onEdit: () => void
}) {
  const t = useTranslations("Automations")
  const locale = useLocale()
  const folders = useAppWorkspaceStore((s) => s.folders)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const folderName =
    folders.find((f) => f.id === automation.root_folder_id)?.name ?? "—"
  // `config` is serialized from an opaque JSON column and falls back to `null`
  // on the backend if the stored blob fails to parse — guard every read so a
  // malformed automation degrades gracefully instead of throwing during render
  // (which, with no error boundary on this route, white-screens the whole app).
  const config = automation.config ?? null
  const labels = config?.label_snapshot
  const configEntries = Object.entries(config?.config_values ?? {})
  // `label_snapshot` freezes whatever the agent CALLED these when the
  // automation was saved — deliberately, so the badges survive the agent being
  // uninstalled. For an agent that hardcodes one language that also freezes the
  // language, and for every automation saved before this existed. Resolve from
  // the stable ids first, fall back to the frozen label, then to the raw id.
  const vocabulary = useAgentVocabulary(automation.agent_type)
  const isSchedule = automation.trigger_kind === "schedule" && !!automation.cron

  return (
    <ScrollArea className="h-full">
      <div className="@container flex w-full flex-col gap-4 p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words text-lg font-semibold [overflow-wrap:anywhere]">
                {automation.name}
              </h2>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              {automation.enabled ? t("enabled") : t("statusDisabled")}
              <Switch
                checked={automation.enabled}
                disabled={busy}
                onCheckedChange={(v) =>
                  run(() => automationSetEnabled(automation.id, v))
                }
                aria-label={t("enabled")}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {automation.last_run_at && (
              <span className="inline-flex items-center gap-1.5">
                {t("lastRun")}{" "}
                <time
                  dateTime={automation.last_run_at}
                  title={new Date(automation.last_run_at).toLocaleString(
                    locale
                  )}
                >
                  {formatDateTime(automation.last_run_at, locale, now)}
                </time>
                <StatusChip status={automation.last_run_status} />
              </span>
            )}
            {isSchedule && automation.enabled && automation.next_run_at && (
              <span>
                {t("nextRun")}{" "}
                <time
                  dateTime={automation.next_run_at}
                  title={new Date(automation.next_run_at).toLocaleString(
                    locale
                  )}
                >
                  {formatDateTime(automation.next_run_at, locale, now)}
                </time>
              </span>
            )}
            <span>
              {isSchedule && automation.cron ? (
                <ScheduleLabel
                  cron={automation.cron}
                  calendarFilter={config?.calendar_filter}
                />
              ) : (
                t(
                  automation.trigger_kind === "message"
                    ? "triggerMessage"
                    : "manual"
                )
              )}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className={cn(
                "h-8 gap-1.5 rounded-md px-3.5 text-[0.8125rem]",
                automation.trigger_kind === "message" && "hidden"
              )}
              onClick={() => run(() => automationRunNow(automation.id))}
              disabled={busy}
            >
              <Play className="size-3.5" aria-hidden="true" />
              {t("runNow")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-md px-3.5 text-[0.8125rem]"
              onClick={onEdit}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              {t("edit")}
            </Button>
          </div>
        </div>

        <RunHistory automation={automation} now={now} onChanged={refetch} />

        <DetailDisclosure
          title={t("sectionSchedule")}
          preview={[
            labels?.agent_label ?? automation.agent_type,
            config?.action === "enqueue_task"
              ? t("actionEnqueueTask")
              : t(
                  config?.session_mode === "reuse_chat"
                    ? "sessionReuse"
                    : "sessionNew"
                ),
          ].join(" · ")}
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 @sm:grid-cols-2 @xl:grid-cols-3">
            <StatItem
              icon={isSchedule ? <CalendarClock /> : <MousePointerClick />}
              label={t("trigger")}
            >
              {isSchedule && automation.cron ? (
                <span className="flex flex-col gap-0.5">
                  <ScheduleLabel
                    cron={automation.cron}
                    calendarFilter={automation.config?.calendar_filter}
                  />
                  <span className="font-mono text-xs text-muted-foreground">
                    {automation.cron}
                  </span>
                </span>
              ) : automation.trigger_kind === "message" ? (
                t("triggerMessage")
              ) : (
                t("manual")
              )}
            </StatItem>
            <StatItem
              icon={
                <AgentIcon
                  agentType={automation.agent_type}
                  className="size-3.5"
                />
              }
              label={t("agent")}
            >
              <span className="block truncate">
                {labels?.agent_label ?? automation.agent_type}
              </span>
            </StatItem>
            {config?.action !== "enqueue_task" && (
              <StatItem icon={<Clock />} label={t("sessionMode")}>
                {config?.session_mode === "reuse_chat"
                  ? t("sessionReuse")
                  : t("sessionNew")}
              </StatItem>
            )}
            <StatItem icon={<Folder />} label={t("folder")}>
              <span className="block truncate">
                {automation.root_folder_id == null
                  ? t("targetChat")
                  : (labels?.folder_label ?? folderName)}
              </span>
            </StatItem>
            {config?.action === "enqueue_task" ? (
              // Isolation/branch never apply to enqueued tasks (the work-task
              // engine mints the worktree); show what firing does instead.
              <StatItem icon={<SquareKanban />} label={t("sectionAction")}>
                {t("actionEnqueueTask")}
              </StatItem>
            ) : automation.root_folder_id != null ? (
              <StatItem icon={<GitBranch />} label={t("isolation")}>
                <span className="block">
                  {automation.isolation === "worktree_per_run"
                    ? t("isolationWorktree")
                    : t("isolationShared")}
                  {automation.isolation === "shared_in_root" &&
                  automation.branch ? (
                    <span className="ml-1 font-mono text-xs text-muted-foreground">
                      {automation.branch}
                    </span>
                  ) : null}
                </span>
              </StatItem>
            ) : null}
            {config?.mode_id || configEntries.length > 0 ? (
              <StatItem icon={<SlidersHorizontal />} label={t("config")}>
                <div className="flex flex-wrap gap-1">
                  {config?.mode_id ? (
                    <Badge variant="outline" className="text-[0.625rem]">
                      {vocabulary.modeLabel(
                        config.mode_id,
                        labels?.mode_label ?? config.mode_id
                      )}
                    </Badge>
                  ) : null}
                  {configEntries.map(([k, v]) => (
                    <Badge
                      key={k}
                      variant="outline"
                      className="text-[0.625rem]"
                    >
                      {vocabulary.configValueLabel(
                        k,
                        v,
                        labels?.config_labels?.[k] ?? v
                      )}
                    </Badge>
                  ))}
                </div>
              </StatItem>
            ) : null}
          </div>
        </DetailDisclosure>

        {automation.trigger_kind === "message" && (
          <MessageListenerPanel
            automation={automation}
            busy={busy}
            onRun={() => run(() => automationRunNow(automation.id))}
          />
        )}

        <AutomationPrompt
          title={t("sectionPrompt")}
          text={config?.display_text || "—"}
        />
      </div>
    </ScrollArea>
  )
}

function RunHistory({
  now,
  automation,
  onChanged,
}: {
  now: number
  automation: Automation
  onChanged: () => Promise<void>
}) {
  const t = useTranslations("Automations")
  const locale = useLocale()
  const [showAll, setShowAll] = useState(false)
  const { openTab } = useTabActions()
  const { openConversations } = useWorkbenchRoute()
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [loading, setLoading] = useState(true)
  const reqRef = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqRef.current
    try {
      const list = await automationRuns(automation.id)
      if (id === reqRef.current) {
        setRuns(list)
      }
    } catch {
      // keep the previous list on transient error
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [automation.id])

  useEffect(() => {
    setLoading(true)
    void load()
    let unsub: (() => void) | undefined
    let cancelled = false
    void subscribe(AUTOMATION_CHANGED_EVENT, () => {
      void load()
    }).then((u: () => void) => {
      if (cancelled) u()
      else unsub = u
    })
    // A run that settled while the WS was disconnected drops its event (the
    // broadcaster skips when receiver_count == 0), so re-load on reconnect to
    // clear a stale "running" row. No-op on desktop IPC.
    const offReconnect = onTransportReconnect(() => {
      void load()
    })
    return () => {
      cancelled = true
      unsub?.()
      offReconnect?.()
    }
  }, [load])

  const viewConversation = async (r: AutomationRun) => {
    if (r.conversation_id == null) return
    try {
      // Chat runs own a hidden folder. Resolve it from the conversation so
      // history remains navigable after a reload or a target change.
      const detail = await getFolderConversation(r.conversation_id, {
        tailTurns: 1,
      })
      openConversations()
      openTab(
        detail.summary.folder_id,
        r.conversation_id,
        automation.agent_type
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const cancel = async (r: AutomationRun) => {
    try {
      await automationCancelRun(r.id)
      await load()
      await onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const visibleRuns = showAll ? runs : runs.slice(0, 4)

  return (
    // A titled Section like the others: it used to be the one block on the page
    // with no boundary at all, which over a background image read as loose text
    // floating on the photo.
    <Section
      title={t("runHistory")}
      action={
        <Button
          size="icon"
          variant="ghost"
          className="-my-1 h-6 w-6 text-muted-foreground"
          onClick={() => void load()}
          title={t("refresh")}
          aria-label={t("refresh")}
        >
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      }
    >
      {loading && runs.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        </div>
      ) : runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("noRuns")}</p>
      ) : (
        <>
          <ol className="flex flex-col">
            {visibleRuns.map((r, i) => (
              <li key={r.id} className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {r.trigger === "manual" ? (
                    <CirclePlay className="size-4" aria-hidden="true" />
                  ) : (
                    <Clock className="size-4" aria-hidden="true" />
                  )}
                </span>
                <div
                  className={cn(
                    "flex min-w-0 flex-1 flex-col gap-0.5",
                    i < visibleRuns.length - 1 && "pb-3"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <time
                      className="text-xs font-medium tabular-nums"
                      dateTime={r.started_at ?? r.created_at}
                      title={new Date(
                        r.started_at ?? r.created_at
                      ).toLocaleString(locale)}
                    >
                      {formatDateTime(
                        r.started_at ?? r.created_at,
                        locale,
                        now
                      )}
                    </time>
                    <StatusChip status={r.status} />
                    {r.ended_at && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatDuration(r.started_at, r.ended_at)}
                      </span>
                    )}
                    {r.conversation_id != null ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0 text-muted-foreground"
                        onClick={() => viewConversation(r)}
                        title={t("viewConversation")}
                        aria-label={t("viewConversation")}
                      >
                        <SquareArrowOutUpRight
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                      </Button>
                    ) : null}
                    {r.status === "running" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => void cancel(r)}
                        title={t("cancelRun")}
                        aria-label={t("cancelRun")}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                  {(r.error || r.summary) && (
                    <details className="group/result min-w-0 text-xs">
                      <summary
                        className={cn(
                          "flex cursor-pointer list-none items-center gap-1 rounded-sm py-1 text-muted-foreground focus-visible:outline-ring [&::-webkit-details-marker]:hidden",
                          r.error && "text-destructive"
                        )}
                      >
                        <ChevronRight
                          aria-hidden="true"
                          className="size-3 shrink-0 group-open/result:rotate-90"
                        />
                        <span className="hidden group-open/result:inline">
                          {t("hideRunResult")}
                        </span>
                        <span className="truncate group-open/result:hidden">
                          {maskAutomationText(
                            (r.error || r.summary || "")
                              .trim()
                              .split(/\r?\n/, 1)[0]
                          )}
                        </span>
                      </summary>
                      <p className="my-1 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 leading-relaxed">
                        {maskAutomationText(r.error || r.summary || "")}
                      </p>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {runs.length > 4 && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-xs text-muted-foreground"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              {t(showAll ? "hideOlderRuns" : "showOlderRuns")}
            </Button>
          )}
        </>
      )}
    </Section>
  )
}
