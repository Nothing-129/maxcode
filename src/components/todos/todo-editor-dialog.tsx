"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { TodoPriority, TodoRequest } from "@/lib/todos"
import type { consumePendingTodoDraft } from "@/lib/todo-compose-events"
import { toErrorMessage } from "@/lib/app-error"
import { randomUUID } from "@/lib/utils"
import type { Todo, TodoMember } from "./board-columns"

import {
  filesFromClipboard,
  clipboardHasText,
  imageFilesFromClipboardApi,
} from "@/lib/clipboard-images"
import { TodoMarkdown } from "./todo-markdown"
import { uploadTodoFile, todoFileMarkdown } from "@/lib/todo-storage"
import { TODO_ATTACHMENT_MAX_BYTES } from "@/lib/todo-storage"

type TodoDraft = NonNullable<ReturnType<typeof consumePendingTodoDraft>>

export function TodoEditorDialog({
  todo,
  draft,
  members,
  onClose,
  onSubmit,
  disabled,
  latestTodo,
  onReload,
  scopeId = "personal",
}: {
  todo: Todo | null
  draft: TodoDraft | null
  members: TodoMember[]
  onClose: () => void
  onSubmit: (request: TodoRequest) => Promise<unknown>
  disabled: boolean
  latestTodo?: Todo
  onReload?: () => void
  scopeId?: string
}) {
  const t = useTranslations("Todos")
  const [title, setTitle] = useState(todo?.title ?? draft?.title ?? "")
  const [content, setContent] = useState(todo?.content ?? draft?.text ?? "")
  const contentRef = useRef(content)
  const textarea = useRef<HTMLTextAreaElement>(null)
  function updateContent(value: string) {
    contentRef.current = value
    setContent(value)
  }
  const [readingFiles, setReadingFiles] = useState(false)
  const readingRef = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [assignee, setAssignee] = useState(todo?.assignee_id ?? "__none__")
  const [dueDate, setDueDate] = useState(todo?.due_date ?? "")
  const [priority, setPriority] = useState<TodoPriority | "__none__">(
    todo?.priority ?? "__none__"
  )
  const [saving, setSaving] = useState(false)
  const [operationId] = useState(randomUUID)
  const [error, setError] = useState<string | null>(null)
  const hasConflict =
    !!todo && !!latestTodo && todo.revision !== latestTodo.revision

  async function addFiles(source: File[] | Promise<File[]>) {
    if (readingRef.current || saving || disabled) return
    const start = textarea.current?.selectionStart ?? contentRef.current.length
    const end = textarea.current?.selectionEnd ?? start
    readingRef.current = true
    setReadingFiles(true)
    setError(null)
    let cursor = start
    let selectionEnd = end
    try {
      const files = await source
      if (
        scopeId === "personal" &&
        files.reduce((sum, file) => sum + file.size, 0) >
          TODO_ATTACHMENT_MAX_BYTES
      ) {
        throw new Error(t("attachmentTooLarge"))
      }
      for (const file of files) {
        const uploaded = await uploadTodoFile(scopeId, file, contentRef.current)
        const markdown = "\n" + todoFileMarkdown(uploaded) + "\n"
        const current = contentRef.current
        updateContent(
          current.slice(0, cursor) + markdown + current.slice(selectionEnd)
        )
        cursor += markdown.length
        selectionEnd = cursor
      }
    } catch (cause) {
      setError(toErrorMessage(cause))
    } finally {
      readingRef.current = false
      setReadingFiles(false)
      requestAnimationFrame(() => {
        textarea.current?.focus()
        textarea.current?.setSelectionRange(cursor, cursor)
      })
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (
      !content.trim() ||
      readingRef.current ||
      saving ||
      disabled ||
      hasConflict
    )
      return
    setSaving(true)
    setError(null)
    try {
      const fields = {
        due_date: dueDate || null,
        priority: priority === "__none__" ? null : priority,
        title: title.trim(),
        content: contentRef.current.trim(),
        assignee_id: assignee === "__none__" ? null : assignee,
      }
      await onSubmit(
        todo
          ? {
              action: "update",
              id: todo.id,
              revision: todo.revision,
              ...fields,
            }
          : {
              action: "create",
              operation_id: operationId,
              ...fields,
              ...(draft?.conversationId != null
                ? {
                    conversation_id: draft.conversationId,
                    share_options: draft.shareOptions,
                  }
                : {}),
            }
      )
      onClose()
    } catch (cause) {
      setError(toErrorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !saving && !readingFiles && onClose()}
    >
      <DialogContent
        className="todo-theme min-w-0 max-w-4xl grid-cols-1 overflow-x-hidden overflow-y-auto [&>*]:min-w-0"
        showCloseButton={!saving && !readingFiles}
      >
        <DialogHeader>
          <DialogTitle>{t(todo ? "editTodo" : "newTodo")}</DialogTitle>
          <DialogDescription>{t("editorDescription")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void submit(event)}
          className="min-w-0 space-y-5 [&>*]:min-w-0"
        >
          <div className="space-y-2">
            <Label htmlFor="todo-title">{t("titleLabel")}</Label>
            <Input
              id="todo-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("titlePlaceholder")}
              disabled={saving || disabled}
            />
            <p className="text-xs text-muted-foreground">{t("titleHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="todo-content">{t("contentLabel")}</Label>
            <div className="grid min-w-0 gap-3 rounded-xl border p-3 md:grid-cols-2">
              <Textarea
                ref={textarea}
                id="todo-content"
                value={content}
                onChange={(event) => updateContent(event.target.value)}
                onPaste={(event) => {
                  const files = filesFromClipboard(event.clipboardData)
                  if (files.length) {
                    event.preventDefault()
                    void addFiles(files)
                  } else if (
                    !readingRef.current &&
                    !clipboardHasText(event.clipboardData)
                  ) {
                    void addFiles(imageFilesFromClipboardApi())
                  }
                }}
                placeholder={t("contentPlaceholder")}
                className="min-h-64 min-w-0 field-sizing-fixed resize-y font-mono text-sm"
                required
                autoFocus
                disabled={saving || disabled || readingFiles}
              />
              <div
                className="min-w-0 max-h-96 overflow-auto"
                aria-label={t("markdownPreview")}
              >
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("markdownPreview")}
                </p>
                <TodoMarkdown content={content} />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              aria-label={t("addAttachments")}
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []))
                event.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || disabled || readingFiles}
              onClick={() => fileInput.current?.click()}
            >
              {readingFiles ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}
              {t("addAttachments")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t(
                scopeId === "personal" ? "attachmentHint" : "teamAttachmentHint"
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="todo-assignee">{t("assigneeLabel")}</Label>
            <Select
              value={assignee}
              onValueChange={setAssignee}
              disabled={saving || disabled}
            >
              <SelectTrigger id="todo-assignee" className="min-w-0 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="todo-theme">
                <SelectItem value="__none__">{t("unassigned")}</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="todo-due-date">{t("dueDate")}</Label>
              <Input
                id="todo-due-date"
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={saving || disabled}
              />
              <p className="text-xs text-muted-foreground">
                {t("dueDateHint")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="todo-priority">{t("priority")}</Label>
              <Select
                value={priority}
                onValueChange={(value) =>
                  setPriority(value as TodoPriority | "__none__")
                }
                disabled={saving || disabled}
              >
                <SelectTrigger id="todo-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="todo-theme">
                  <SelectItem value="__none__">{t("noPriority")}</SelectItem>
                  {(["low", "normal", "high", "urgent"] as const).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {t(`priority_${value}`)}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          {draft?.conversationId != null && (
            <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">
              {t("conversationShareHint")}
            </p>
          )}
          {hasConflict && (
            <div
              role="alert"
              className="space-y-2 rounded-xl bg-amber-500/10 p-3"
            >
              <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                {t("conflictHint")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReload}
                disabled={saving || readingFiles}
              >
                {t("reloadLatest")}
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive wrap-anywhere">
              {t("operationFailed", { reason: error })}
            </p>
          )}
          <DialogFooter className="min-w-0 sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving || readingFiles}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                !content.trim() ||
                readingFiles ||
                saving ||
                disabled ||
                hasConflict
              }
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t(saving ? "saving" : "save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
