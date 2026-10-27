"use client"

import { useContext, useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon, Maximize2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  StreamdownContext,
  defaultTranslations,
  TableDownloadDropdown,
  extractTableDataFromElement,
  tableDataToCSV,
  tableDataToMarkdown,
  tableDataToTSV,
  type Components,
  type TableData,
} from "streamdown"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/** Plain text contains rendered labels only; no Markdown or rich clipboard data. */
export function tableDataToPlainText(data: TableData): string {
  return [data.headers, ...data.rows]
    .map((row) =>
      row.map((cell) => cell.replace(/\s+/g, " ").trim()).join("   ")
    )
    .join("\n")
}

const controlClass =
  "cursor-pointer p-1 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"

function TableCopyMenu() {
  const t = useTranslations("MarkdownTable")
  const { isAnimating, controls } = useContext(StreamdownContext)
  const translations = defaultTranslations
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const tableControls =
    typeof controls === "object" ? controls.table : undefined
  const separator =
    typeof tableControls === "object" ? tableControls.csvSeparator : undefined

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  async function copy(format: "text" | "md" | "csv" | "tsv") {
    const table = trigger.current
      ?.closest('[data-streamdown="table-wrapper"]')
      ?.querySelector("table")
    if (!table) return
    const data = extractTableDataFromElement(table)
    const text =
      format === "text"
        ? tableDataToPlainText(data)
        : format === "md"
          ? tableDataToMarkdown(data)
          : format === "csv"
            ? tableDataToCSV(data, separator)
            : tableDataToTSV(data)
    try {
      if (format === "text" || !navigator.clipboard.write) {
        await navigator.clipboard.writeText(text)
      } else {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([table.outerHTML], { type: "text/html" }),
          }),
        ])
      }
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={trigger}
          type="button"
          className={controlClass}
          disabled={isAnimating}
          aria-label={translations.copyTable}
          title={translations.copyTable}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(
          [
            ["text", t("plainText")],
            ["md", translations.tableFormatMarkdown],
            ["csv", translations.tableFormatCsv],
            ["tsv", translations.tableFormatTsv],
          ] as const
        ).map(([format, label]) => (
          <DropdownMenuItem key={format} onSelect={() => void copy(format)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const MarkdownTable: Components["table"] = ({
  children,
  className,
  node: _node,
  ...props
}) => {
  void _node
  const { controls, isAnimating, tableMaxHeight } =
    useContext(StreamdownContext)
  // Preserve Streamdown's bounded streaming table behavior: follow new rows
  // until the reader scrolls up, then leave their position alone.
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const maxHeight =
    tableMaxHeight === 0 ||
    tableMaxHeight === Infinity ||
    ["0", "none", "Infinity"].includes(String(tableMaxHeight))
      ? undefined
      : tableMaxHeight
  useEffect(() => {
    if (!isAnimating) following.current = true
    const element = viewport.current
    if (!element || !maxHeight || !isAnimating || !following.current) return
    const frame = requestAnimationFrame(() => {
      if (following.current) element.scrollTop = element.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [children, isAnimating, maxHeight])
  const translations = defaultTranslations
  const config = typeof controls === "object" ? controls.table : controls
  const enabled = config !== false
  const copy = enabled && (typeof config !== "object" || config.copy !== false)
  const download =
    enabled && (typeof config !== "object" || config.download !== false)
  const fullscreen =
    enabled && (typeof config !== "object" || config.fullscreen !== false)
  const toolbar = (
    <>
      {copy && <TableCopyMenu />}
      {download && <TableDownloadDropdown />}
    </>
  )
  const table = (
    <table
      {...props}
      data-streamdown="table"
      className={cn("w-full divide-y divide-border", className)}
    >
      {children}
    </table>
  )

  return (
    <div
      data-streamdown="table-wrapper"
      className="my-4 flex flex-col gap-2 rounded-lg border border-border bg-sidebar p-2"
    >
      {enabled && (
        <div className="flex items-center justify-end gap-1">
          {toolbar}
          {fullscreen && (
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className={controlClass}
                  disabled={isAnimating}
                  aria-label={translations.viewFullscreen}
                  title={translations.viewFullscreen}
                >
                  <Maximize2Icon size={14} />
                </button>
              </DialogTrigger>
              <DialogContent
                data-streamdown="table-fullscreen"
                className="h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] gap-2 rounded-lg p-4"
              >
                <DialogTitle className="sr-only">
                  {translations.viewFullscreen}
                </DialogTitle>
                <div
                  data-streamdown="table-wrapper"
                  className="flex min-h-0 flex-col gap-2"
                >
                  <div className="flex justify-end gap-1 pr-10">{toolbar}</div>
                  <div className="min-h-0 overflow-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
                    {table}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
      <div
        className="overflow-auto rounded-md border border-border bg-background"
        ref={viewport}
        onScroll={(event) => {
          const element = event.currentTarget
          following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 8
        }}
        style={{ maxHeight }}
      >
        {table}
      </div>
    </div>
  )
}

export const markdownTableComponents = {
  table: MarkdownTable,
} satisfies Components
