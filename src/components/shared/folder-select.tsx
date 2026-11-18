"use client"

import { defaultFilter } from "cmdk"
import { SELECTOR_MENU_SURFACE } from "@/components/chat/selector-menu-style"
import { memo, useState } from "react"
import { useTranslations } from "next-intl"
import { Check, ChevronDown, Folder, MessageSquare } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { SelectorTooltip } from "@/components/chat/selector-tooltip"
import { FolderAliasLabel } from "@/components/conversations/folder-alias-label"
import { cn } from "@/lib/utils"

/** The minimum a folder has to carry to be listed. `alias`/`path` are optional
 *  so a caller can offer a folder it only knows by id (an automation targeting
 *  a folder that is no longer in the workspace, say). */
export interface FolderSelectOption {
  id: number
  name: string
  alias?: string | null
  path?: string | null
}

/**
 * The string cmdk matches the query against. Everything the user might type for
 * a folder goes in — the alias, the real directory name, and the full path — so
 * an aliased folder is still findable by its on-disk name.
 */
function folderSearchValue(f: FolderSelectOption): string {
  return `${f.alias ?? ""} ${f.name} ${f.path ?? ""}`
}

export const FolderOptionItem = memo(function FolderOptionItem({
  folder,
  selected,
  showPath = false,
  onSelect,
}: {
  folder: FolderSelectOption
  selected: boolean
  showPath?: boolean
  onSelect: () => void
}) {
  return (
    <CommandItem
      value={String(folder.id)}
      onSelect={onSelect}
      title={folder.path ?? undefined}
      data-current={selected}
      className="min-h-8 gap-2.5 rounded-lg px-2.5 py-1.5 data-[selected=true]:bg-transparent hover:bg-muted/60 data-[selected=true]:hover:bg-muted/60 [&_svg]:stroke-[1.5]"
    >
      <Folder className="h-4 w-4" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-normal">
          <FolderAliasLabel name={folder.name} alias={folder.alias ?? null} />
        </span>
        {folder.path && showPath ? (
          // Paths read LTR even in RTL locales, and the full value survives
          // truncation via the tooltip.
          <span
            dir="ltr"
            title={folder.path}
            className="truncate text-start text-xs text-muted-foreground"
          >
            {folder.path}
          </span>
        ) : null}
      </div>
      {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
    </CommandItem>
  )
})

interface FolderMenuProps {
  folders: readonly FolderSelectOption[]
  value: number | null
  labelSearch: string
  labelEmpty: string
  onSelect: (id: number) => void
  footer?: {
    label: string
    description?: string
    chat?: boolean
    selected: boolean
    onSelect: () => void
  }
  composer?: boolean
}

export function FolderMenuContent({
  alignOffset,
  ...props
}: FolderMenuProps & { alignOffset?: number }) {
  return (
    <PopoverContent
      align="start"
      alignOffset={alignOffset}
      className={cn(
        SELECTOR_MENU_SURFACE,
        "w-72 overflow-hidden max-h-(--radix-popover-content-available-height) shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08)]"
      )}
      data-composer-selector-content={props.composer ? "" : undefined}
    >
      <FolderMenuList {...props} />
    </PopoverContent>
  )
}

function FolderMenuList({
  folders,
  value,
  labelSearch,
  labelEmpty,
  onSelect,
  footer,
  composer,
}: FolderMenuProps) {
  const [query, setQuery] = useState("")
  const displayName = (folder: FolderSelectOption) =>
    folder.alias?.trim() || folder.name
  const nameCounts = new Map<string, number>()
  for (const folder of folders)
    nameCounts.set(
      displayName(folder),
      (nameCounts.get(displayName(folder)) ?? 0) + 1
    )
  const visibleFolders = folders.filter(
    (folder) => defaultFilter(folderSearchValue(folder), query) > 0
  )

  const FooterIcon = footer?.chat ? MessageSquare : Folder
  return (
    <Command
      shouldFilter={false}
      onKeyDown={composer ? undefined : (event) => event.stopPropagation()}
      className="min-h-0 rounded-xl [&_[cmdk-input-wrapper]]:mx-1 [&_[cmdk-input-wrapper]]:shrink-0 [&_[cmdk-input-wrapper]]:px-1 [&_[cmdk-input-wrapper]]:py-2.5 [&_[cmdk-input-wrapper]]:border-border/60"
    >
      <CommandInput
        autoFocus
        value={query}
        onValueChange={setQuery}
        placeholder={labelSearch}
        className="h-8 rounded-full bg-muted/70 px-3 py-1 text-xs"
      />
      <CommandList className="flex min-h-0 max-h-none flex-col overflow-hidden">
        <div
          data-folder-scroll=""
          className="min-h-0 max-h-64 overflow-y-auto overscroll-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleFolders.length === 0 && (
            <div
              role="status"
              className="px-3 py-6 text-center text-xs text-muted-foreground"
            >
              {labelEmpty}
            </div>
          )}
          <CommandGroup>
            {/* Keep project names on one line; paths remain searchable. */}
            {visibleFolders.map((f) => (
              <FolderOptionItem
                showPath={(nameCounts.get(displayName(f)) ?? 0) > 1}
                key={f.id}
                folder={f}
                selected={f.id === value}
                onSelect={() => onSelect(f.id)}
              />
            ))}
          </CommandGroup>
        </div>
        {footer && (
          <div
            data-folder-chat-footer={footer.chat ? "" : undefined}
            className="shrink-0 bg-popover"
          >
            <CommandSeparator className="mx-2 bg-border/60" />
            <CommandGroup forceMount>
              <CommandItem
                value="__folder_footer__"
                title={footer.description}
                className="min-h-8 gap-2.5 rounded-lg px-2.5 py-1.5 text-muted-foreground data-[selected=true]:bg-transparent hover:bg-muted/60 data-[selected=true]:hover:bg-muted/60 [&_svg]:stroke-[1.5]"
                forceMount
                onSelect={footer.onSelect}
              >
                <FooterIcon className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate font-normal text-foreground">
                  {footer.label}
                </span>
                {footer.selected && <Check className="h-4 w-4 shrink-0" />}
              </CommandItem>
            </CommandGroup>
          </div>
        )}
      </CommandList>
    </Command>
  )
}

/** Trigger looks. `"pill"` is the borderless muted filter pill the workbench
 *  toolbars use; `"field"` is the bordered form control the editor dialogs put
 *  in their Target section (metrics copied from `SelectTrigger size="sm"`);
 *  `"ghost"` is the pill with no surface of its own, for a picker sitting
 *  INSIDE another chip — a second fill there reads as a nested control, and
 *  `ws-msg-chip` would draw one whatever the caller sets, since it paints from
 *  an unlayered rule that outranks a utility class. */
type FolderSelectVariant = "pill" | "field" | "ghost"

const TRIGGER_CLASS: Record<FolderSelectVariant, string> = {
  pill: "h-8 w-auto min-w-0 max-w-[14rem] gap-1.5 rounded-full border-transparent bg-muted/70 px-3 text-[0.8125rem] font-medium shadow-none ws-msg-chip hover:bg-interaction-hover",
  field:
    "h-7 w-auto min-w-0 max-w-[16rem] gap-1.5 rounded-4xl border-input bg-input/30 px-3 text-xs font-normal hover:bg-input/50 dark:hover:bg-input/50",
  ghost:
    "h-7 w-auto min-w-0 max-w-[14rem] gap-1.5 rounded-full border-transparent px-2.5 text-[0.8125rem] font-medium shadow-none hover:bg-interaction-hover dark:hover:bg-interaction-hover",
}

interface FolderSelectProps {
  id?: string
  folders: readonly FolderSelectOption[]
  /** The chosen folder id, or `null` for "no choice yet" / "all folders". */
  value: number | null
  onChange: (folderId: number) => void
  /** Supplied by filters: adds a pinned "all folders" row and makes `null` a
   *  real, selectable state. Omit for a picker that must end up on a folder. */
  allLabel?: string
  /** Show the folderless-chat icon and explanation for the null choice. */
  chatFooter?: boolean
  /** Trigger text while nothing is selected and there is no `allLabel`. */
  placeholder?: string
  /** Called when the pinned "all folders" row is picked. Required with
   *  `allLabel`. */
  onSelectAll?: () => void
  variant?: FolderSelectVariant
  disabled?: boolean
  /** Names the axis in the trigger's hover hint, e.g. "Working folder". Hint
   *  only — the accessible name stays the trigger's own text, so a screen
   *  reader announces WHICH folder is picked rather than just the axis. */
  title?: string
  className?: string
}

/** Searchable single-folder field and filter, with an optional null choice. */
export function FolderSelect({
  id,
  folders,
  value,
  onChange,
  allLabel,
  chatFooter = false,
  placeholder,
  onSelectAll,
  variant = "pill",
  disabled = false,
  title,
  className,
}: FolderSelectProps) {
  // Shared with the composer's picker: same control, same two strings — a
  // second copy per page would only drift in translation.
  const t = useTranslations("Folder.conversationContextBar")
  const [open, setOpen] = useState(false)

  const current =
    value != null ? folders.find((f) => f.id === value) : undefined
  // A selection the list can no longer resolve — the folder was closed or
  // removed from the workspace while it was the chosen one. It must NOT read as
  // the null state: the caller is still filtering (or saving) by that id, so
  // showing "all folders" / the placeholder would state the opposite of what
  // the page is doing. Named by the only handle left, its id — the same `#<id>`
  // idiom the Automations list uses for a folder it can only name that way.
  const unresolved = value != null && !current
  const fallbackText = unresolved
    ? `#${value}`
    : (allLabel ?? placeholder ?? "")
  // Hover hint: the axis the caller named ("Working folder"), over the selected
  // folder's path — the one thing the trigger never shows, and the only thing
  // that separates same-named repos. The folder's own name is deliberately NOT
  // repeated: it is the trigger's own text. A filter pill that names no axis
  // and has no selection therefore has nothing to say, and shows no hint.

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (!disabled) setOpen(o)
      }}
    >
      {/* `suppressed` while the list is open: the Popover is non-modal, so the
          trigger keeps taking hover underneath its own panel. `disabled` falls
          the hint back to a native `title` — a disabled trigger takes no
          pointer events, and a pinned folder can't be opened to inspect. */}
      <SelectorTooltip
        label={title}
        description={current?.path}
        suppressed={open}
        disabled={disabled}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant={variant === "field" ? "outline" : "ghost"}
            size="sm"
            disabled={disabled}
            className={cn(TRIGGER_CLASS[variant], className)}
          >
            <Folder
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span
              className={cn(
                // `flex-1` + `text-start` only bite when a caller stretches the
                // trigger past its content (a fixed-width filter column): the
                // label takes the slack and stays left-aligned with the icon,
                // instead of the whole icon/label/chevron group floating in the
                // middle of the pill. At the default content width there is no
                // slack, so nothing moves.
                "min-w-0 flex-1 truncate text-start",
                !current &&
                  (placeholder || unresolved) &&
                  "text-muted-foreground"
              )}
            >
              {current ? (
                <FolderAliasLabel
                  name={current.name}
                  alias={current.alias ?? null}
                />
              ) : (
                fallbackText
              )}
            </span>
            <ChevronDown
              className="size-3.5 shrink-0 text-muted-foreground/60"
              aria-hidden="true"
            />
          </Button>
        </PopoverTrigger>
      </SelectorTooltip>
      <FolderMenuContent
        folders={folders}
        value={value}
        labelSearch={t("searchFolder")}
        labelEmpty={t("noFolders")}
        onSelect={(id) => {
          setOpen(false)
          onChange(id)
        }}
        footer={
          allLabel
            ? {
                label: allLabel,
                description: chatFooter ? t("chatModeDescription") : undefined,
                chat: chatFooter,
                selected: value === null,
                onSelect: () => {
                  setOpen(false)
                  onSelectAll?.()
                },
              }
            : undefined
        }
      />
    </Popover>
  )
}
