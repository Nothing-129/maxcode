"use client"

import { Download, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import type { TodoAttachment } from "@/lib/todo-attachments"

export function TodoAttachments({
  files,
  onRemove,
  disabled,
}: {
  files: TodoAttachment[]
  onRemove?: (index: number) => void
  disabled?: boolean
}) {
  const t = useTranslations("Todos")
  return (
    <div className="space-y-2">
      {files.map((file, index) => (
        <div key={index} className="min-w-0 rounded-lg border p-2">
          {/^data:image\/(png|jpeg|gif|webp);base64,/.test(file.data) && (
            // Only raster images render inline; other formats download as files.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.data}
              alt={file.name}
              className="mb-2 max-h-48 max-w-full rounded object-contain"
            />
          )}
          <div className="flex min-w-0 items-center gap-2">
            <a
              href={file.data}
              download={file.name}
              className="flex min-w-0 flex-1 items-center gap-2 text-sm text-primary"
              onClick={(event) => event.stopPropagation()}
            >
              <Download className="size-4 shrink-0" />
              <span className="truncate">{file.name}</span>
            </a>
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={t("removeAttachment", { name: file.name })}
                onClick={() => onRemove(index)}
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
