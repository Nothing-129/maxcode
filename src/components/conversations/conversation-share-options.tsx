"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm font-medium">
        <span>{t("shareScope")}</span>
        <Select
          disabled={disabled}
          value={options.rounds ? "selected" : "all"}
          onValueChange={(value) =>
            onChange({
              ...options,
              rounds:
                value === "all"
                  ? undefined
                  : rounds.map((round) => round.number),
            })
          }
        >
          <SelectTrigger
            aria-label={t("shareScope")}
            className="min-w-0 max-w-full basis-full sm:max-w-[65%] sm:basis-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("shareAllRounds", { count: rounds.length })}
            </SelectItem>
            <SelectItem value="selected">{t("shareSelectRounds")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {options.rounds && (
        <fieldset className="min-w-0 max-h-56 w-full space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border p-2">
          <legend className="sr-only">{t("shareSelectRounds")}</legend>
          {rounds.map((round) => (
            <label
              key={round.number}
              className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-interaction-hover"
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
    </div>
  )
}
