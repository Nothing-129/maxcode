"use client"

import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  AutomationMessageScope,
  AutomationMessageTrigger,
} from "@/lib/types"

export const DEFAULT_MESSAGE_TRIGGER: AutomationMessageTrigger = {
  scope: "at-me",
  target: "",
  profile: "",
  keywords: "",
  batch_minutes: 10,
}
export function AutomationMessageSettings({
  value,
  onChange,
}: {
  value: AutomationMessageTrigger
  onChange: (value: AutomationMessageTrigger) => void
}) {
  const t = useTranslations("Automations")
  const needsTarget = value.scope === "sender" || value.scope === "group"
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/40 p-3">
      <p className="text-xs text-muted-foreground">{t("messageTriggerHint")}</p>
      <div className="grid gap-3 @sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="automation-message-scope">{t("messageScope")}</Label>
          <Select
            value={value.scope}
            onValueChange={(scope: AutomationMessageScope) =>
              onChange({ ...value, scope, target: "" })
            }
          >
            <SelectTrigger id="automation-message-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                ["at-me", "sender", "group", "all-direct", "all-group"] as const
              ).map((scope) => (
                <SelectItem key={scope} value={scope}>
                  {t(`messageScope_${scope}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="automation-message-batch">{t("messageBatch")}</Label>
          <Select
            value={String(value.batch_minutes)}
            onValueChange={(v) =>
              onChange({ ...value, batch_minutes: Number(v) })
            }
          >
            <SelectTrigger id="automation-message-batch">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 10, 30, 60].map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes === 0
                    ? t("messageImmediate")
                    : t("messageBatchMinutes", { minutes })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {needsTarget && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="automation-message-target">
            {value.scope === "sender" ? t("messageSender") : t("messageGroup")}
          </Label>
          <Input
            id="automation-message-target"
            value={value.target}
            onChange={(e) => onChange({ ...value, target: e.target.value })}
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="automation-message-keywords">
          {t("messageKeywords")}
        </Label>
        <Input
          id="automation-message-keywords"
          value={value.keywords}
          onChange={(e) => onChange({ ...value, keywords: e.target.value })}
          placeholder={t("messageKeywordsPlaceholder")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="automation-message-profile">
          {t("messageProfile")}
        </Label>
        <Input
          id="automation-message-profile"
          value={value.profile}
          onChange={(e) => onChange({ ...value, profile: e.target.value })}
          placeholder={t("messageProfilePlaceholder")}
        />
      </div>
    </div>
  )
}
