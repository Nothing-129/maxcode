"use client"

import { useTranslations } from "next-intl"
import { Checkbox } from "@/components/ui/checkbox"
import type { ConversationShareRoundPreview } from "@/lib/api"
import type { ConversationShareOptions } from "@/lib/types"

export function ConversationShareOptionsEditor({
  rounds,
  options,
  onChange,
  disabled = false,
}: {
  rounds: ConversationShareRoundPreview[]
  options: ConversationShareOptions
  onChange: (options: ConversationShareOptions) => void
  disabled?: boolean
}) {
  const t = useTranslations("Folder.conversationCard")
  return (
    <div className="min-w-0 w-full space-y-4">
      <p className="text-sm text-muted-foreground wrap-anywhere">
        {t("shareContentHint")}
      </p>
      <label className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm font-medium">
        {t("shareScope")}
        <select
          disabled={disabled}
          className="outline-none focus-visible:border-[#216ae4] focus-visible:ring-0 min-w-0 max-w-full basis-full rounded-lg border bg-background px-3 py-2 text-sm sm:max-w-[65%] sm:basis-auto"
          value={options.rounds ? "selected" : "all"}
          onChange={(event) =>
            onChange({
              ...options,
              rounds:
                event.target.value === "all"
                  ? undefined
                  : rounds.map((round) => round.number),
            })
          }
        >
          <option value="all">
            {t("shareAllRounds", { count: rounds.length })}
          </option>
          <option value="selected">{t("shareSelectRounds")}</option>
        </select>
      </label>
      {options.rounds && (
        <fieldset className="min-w-0 max-h-56 w-full space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border p-2">
          <legend className="sr-only">{t("shareSelectRounds")}</legend>
          {rounds.map((round) => (
            <label
              key={round.number}
              className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted"
            >
              <Checkbox
                disabled={disabled}
                className="mt-0.5 shrink-0"
                checked={options.rounds!.includes(round.number)}
                onCheckedChange={(checked) =>
                  onChange({
                    ...options,
                    rounds: checked
                      ? [...options.rounds!, round.number].sort((a, b) => a - b)
                      : options.rounds!.filter(
                          (number) => number !== round.number
                        ),
                  })
                }
              />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">
                  {t("shareRound", { number: round.number })}
                </span>
                <span className="mt-0.5 line-clamp-2 wrap-anywhere text-xs text-muted-foreground">
                  {round.preview || t("shareAttachment")}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="space-y-3 rounded-xl bg-muted/50 p-3">
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Checkbox
            disabled={disabled}
            checked={options.includeTools ?? false}
            onCheckedChange={(checked) =>
              onChange({ ...options, includeTools: checked === true })
            }
          />
          {t("shareIncludeTools")}
        </label>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Checkbox
            disabled={disabled}
            checked={options.includeThinking ?? false}
            onCheckedChange={(checked) =>
              onChange({ ...options, includeThinking: checked === true })
            }
          />
          {t("shareIncludeThinking")}
        </label>
        {options.includeTools || options.includeThinking ? (
          <p className="text-xs text-muted-foreground">
            {t("shareExecutionHint")}
          </p>
        ) : null}
      </div>
    </div>
  )
}
