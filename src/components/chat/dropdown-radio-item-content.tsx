"use client"

import { ShieldAlert, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface DropdownRadioItemContentProps {
  configId?: string
  valueId?: string
  label: string
  description?: string | null
  /** Localized "recommended" chip text, or null/absent for the usual row. Set it
   *  only on the value the AGENT recommends (ACP `recommendedValue`) — a claim
   *  independent of what is currently selected, which is the checkmark's job, so
   *  both can land on the same row or on different ones.
   *
   *  Passed in rather than translated here on purpose: every other label this
   *  leaf renders arrives the same way, and the callers all hold a translator
   *  already. */
  recommendedLabel?: string | null
}

export function DropdownRadioItemContent({
  configId,
  valueId,
  label,
  description,
  recommendedLabel,
}: DropdownRadioItemContentProps) {
  const normalizedDescription = description?.trim()
  const permission = /(?:mode|sandbox|approval)/i.test(configId ?? "")
  const fullAccess =
    permission &&
    ["agent-full-access", "danger-full-access", "full-access"].includes(
      valueId ?? ""
    )
  const autoReview =
    permission &&
    (["auto-review", "auto_review"].includes(valueId ?? "") ||
      (valueId === "agent" && label === "Auto review"))
  const ultra =
    /reasoning|effort|thinking/i.test(configId ?? "") && valueId === "ultra"
  const chinese = /[\u3400-\u9fff]/.test(normalizedDescription ?? "")
  const riskNote = fullAccess
    ? chinese
      ? "建议仅在可信环境中启用"
      : "Use only in a trusted environment"
    : autoReview
      ? chinese
        ? "自动风险识别可能存在遗漏"
        : "Automatic risk detection may miss unsafe actions"
      : null
  const badge = recommendedLabel?.trim()

  return (
    <div className="w-full min-w-0 flex-1" title={label}>
      {/* The badge is `shrink-0` (Badge's own base class) so a long model name
          truncates instead of squeezing the chip away. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 truncate text-sm font-medium leading-5">
          {label}
        </p>
        {ultra && (
          <Zap
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        {fullAccess && (
          <ShieldAlert
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        {badge ? (
          <Badge variant="outline" className="px-1 text-3xs font-normal">
            {badge}
          </Badge>
        ) : null}
      </div>
      {normalizedDescription ? (
        <p className="text-muted-foreground mt-0.5 text-xs leading-[1.5] whitespace-pre-wrap wrap-break-word">
          {normalizedDescription}
        </p>
      ) : null}
      {riskNote && (
        <p className="mt-1 text-xs leading-[1.5] text-muted-foreground">
          {riskNote}
        </p>
      )}
    </div>
  )
}
