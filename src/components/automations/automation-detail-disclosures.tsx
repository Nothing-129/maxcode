import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"

export function DetailDisclosure({
  title,
  preview,
  children,
}: {
  title: string
  preview: ReactNode
  children: ReactNode
}) {
  return (
    <details className="group/disclosure min-w-0 border-t border-border/70">
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-sm py-3 outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="mt-1 line-clamp-2 break-words text-xs leading-5 text-muted-foreground group-open/disclosure:hidden">
            {preview}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-muted-foreground group-open/disclosure:rotate-180"
        />
      </summary>
      <div className="min-w-0 pb-3">{children}</div>
    </details>
  )
}

// Mask credentials on the read-only detail surface; the editor owns the source.
export function maskAutomationText(text: string) {
  return text.replace(
    /([?&](?:token|access_token|api[_-]?key|secret|password)=)[^&#\s"'`]+/gi,
    "$1••••"
  )
}

export function AutomationPrompt({
  title,
  text,
}: {
  title: string
  text: string
}) {
  const display = maskAutomationText(text)
  // Preserve prose and whitespace around pasted shell commands and fenced snippets.
  const blocks = display.split(
    /(^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[ \t]*$|^[ \t]*curl\b(?:[^\n]*\\\r?\n)*[^\n]*)/gm
  )
  const preview = (blocks[0].trim() || display.trim())
    .split(/\r?\n/, 2)
    .join(" ")
    .slice(0, 240)
  return (
    <DetailDisclosure title={title} preview={preview}>
      {blocks.map((block, index) =>
        !block.trim() ? null : index % 2 ? (
          <pre
            key={index}
            className="my-2 max-w-full overflow-x-auto rounded-md bg-muted/50 p-3 text-xs leading-5"
          >
            <code>{block}</code>
          </pre>
        ) : (
          <p
            key={index}
            className="max-w-[82ch] whitespace-pre-wrap break-words text-sm leading-relaxed"
          >
            {block.trim()}
          </p>
        )
      )}
    </DetailDisclosure>
  )
}
