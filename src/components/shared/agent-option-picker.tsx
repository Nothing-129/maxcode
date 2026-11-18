"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { ModelOptionPicker } from "@/components/chat/model-option-picker"
import { InlineSessionConfigSelector } from "@/components/chat/session-config-selector"
import { InlineModeSelector } from "@/components/chat/mode-selector"
import {
  modelListGroups,
  shouldSearchModelOptions,
} from "@/lib/model-config-groups"
import type { SessionConfigOptionInfo, SessionModeInfo } from "@/lib/types"

// Inheritance is a form choice. Only a concrete protocol value or null
// crosses the form boundary.
const INHERIT = "__codeg_default__"

interface OverrideProps {
  value: string | null
  inheritLabel?: string
  onChange: (value: string | null) => void
  disabled?: boolean
  showHint?: boolean
}

export function AgentOptionPicker({
  option,
  value,
  inheritLabel,
  onChange,
  disabled,
  showHint,
  footer,
  triggerSuffix,
}: OverrideProps & {
  option: SessionConfigOptionInfo
  footer?: ReactNode
  triggerSuffix?: string
}) {
  const t = useTranslations("Folder.chat.messageInput")
  if (option.kind.type !== "select") return null
  const current = value ?? (inheritLabel ? INHERIT : option.kind.current_value)
  const groups = modelListGroups(option)
  if (inheritLabel)
    groups.unshift({
      key: INHERIT,
      name: null,
      options: [{ value: INHERIT, name: inheritLabel }],
    })
  const props = {
    option: { ...option, kind: { ...option.kind, current_value: current } },
    onSelect: (_id: string, selected: string) =>
      onChange(inheritLabel && selected === INHERIT ? null : selected),
    disabled,
    showHint,
    footer,
    triggerSuffix,
  }
  return shouldSearchModelOptions(option) ? (
    <ModelOptionPicker {...props} groups={groups} />
  ) : (
    <InlineSessionConfigSelector
      {...props}
      derivedGroups={groups}
      recommendedLabel={t("recommendedBadge")}
    />
  )
}

export function AgentModePicker({
  modes,
  label,
  current,
  value,
  inheritLabel,
  onChange,
  disabled,
  showHint,
}: OverrideProps & {
  modes: SessionModeInfo[]
  label: string
  current: string
}) {
  return (
    <InlineModeSelector
      label={label}
      modes={
        inheritLabel ? [{ id: INHERIT, name: inheritLabel }, ...modes] : modes
      }
      selectedModeId={value ?? (inheritLabel ? INHERIT : current)}
      onSelect={(id) => onChange(inheritLabel && id === INHERIT ? null : id)}
      disabled={disabled}
      showHint={showHint}
    />
  )
}
