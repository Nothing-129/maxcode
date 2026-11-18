"use client"

import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AgentModePicker,
  AgentOptionPicker,
} from "@/components/shared/agent-option-picker"
import {
  ModelFastMode,
  isFastModeEnabled,
} from "@/components/chat/model-fast-mode"
import { isModelConfigOption } from "@/lib/model-config-groups"
import { secondaryComposerConfig } from "@/lib/composer-config-visibility"
import { cn } from "@/lib/utils"
import type {
  AgentOptionsSnapshot,
  AgentType,
  SessionConfigOptionInfo,
} from "@/lib/types"
import { useAgentVocabulary } from "@/hooks/use-agent-vocabulary"

interface AgentConfigSectionProps {
  /** Probe result, owned by the parent (so a single probe also feeds the `/`
   *  command menu). Null while loading / on error / before the first probe. */
  snapshot: AgentOptionsSnapshot | null
  /** Which agent the snapshot came from. Only used to localise the agent's own
   *  mode / option vocabulary (see `lib/agent-label-vocabulary`); optional so a
   *  caller without it keeps verbatim rendering. */
  agentType?: AgentType | null
  loading: boolean
  error: string | null
  onReload: () => void
  modeId: string | null
  configValues: Record<string, string>
  onModeChange: (modeId: string | null) => void
  onConfigChange: (optionId: string, valueId: string | null) => void
  /** "stacked" (default) renders the labeled card used in standalone forms;
   *  "inline" renders compact label-less select chips that sit in the
   *  composer-style editor's bottom bar. */
  layout?: "stacked" | "inline"
}

function modelFastOption(snapshot: AgentOptionsSnapshot) {
  if (
    !snapshot.config_options.some(
      (option) => option.kind.type === "select" && isModelConfigOption(option)
    )
  )
    return undefined
  return snapshot.config_options.find((option) => {
    if (secondaryComposerConfig(option) !== "fast") return false
    if (option.kind.type === "boolean") return true
    const values = new Set(
      [
        ...option.kind.options,
        ...option.kind.groups.flatMap((group) => group.options),
      ].map((item) => item.value)
    )
    return (
      values.size === 2 &&
      ((values.has("on") && values.has("off")) ||
        (values.has("true") && values.has("false")))
    )
  })
}

/**
 * The composer's model / mode / permission config surface. The probe is owned
 * by the parent (`useAgentOptions`) and passed in, so the editor runs a single
 * transient session that feeds both these selectors and the `/` command menu.
 */
export function AgentConfigSection({
  snapshot,
  loading,
  error,
  onReload,
  modeId,
  configValues,
  onModeChange,
  onConfigChange,
  layout = "stacked",
  agentType,
}: AgentConfigSectionProps) {
  const t = useTranslations("Automations")
  const vocabulary = useAgentVocabulary(agentType)
  const inline = layout === "inline"

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-xs text-muted-foreground",
          // Inline shares the composer's bottom bar with the "+" button: hold
          // the same 24px the chips will occupy so the bar neither jumps nor
          // leaves this line sitting lower than the "+" while the probe runs.
          inline && "h-6"
        )}
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        {t("probing")}
      </div>
    )
  }
  if (error) {
    // Same 24px line in the composer bar — a stacked message plus a full-size
    // button would double the bottom bar's height on a failed probe.
    if (inline) {
      return (
        <div className="flex h-6 min-w-0 items-center gap-2">
          <p
            className="min-w-0 truncate text-xs text-destructive"
            title={error}
          >
            {error}
          </p>
          <Button
            size="xs"
            variant="ghost"
            className="shrink-0"
            onClick={onReload}
          >
            {t("retry")}
          </Button>
        </div>
      )
    }
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-destructive">{error}</p>
        <Button size="sm" variant="outline" onClick={onReload}>
          {t("retry")}
        </Button>
      </div>
    )
  }
  if (!snapshot) return null

  const hasModes = !!snapshot.modes && snapshot.modes.available_modes.length > 0
  const hasOptions = snapshot.config_options.length > 0
  if (!hasModes && !hasOptions) {
    // Inline lives in the composer bottom bar — stay silent rather than print a
    // sentence there; the stacked form still surfaces the hint.
    if (inline) return null
    return <p className="text-xs text-muted-foreground">{t("configNone")}</p>
  }
  // Mirror the composer: when an agent exposes both modes AND config options,
  // hide the standalone mode row (some agents surface mode as a config option).
  const showMode = hasModes && !hasOptions
  const fastOption = inline ? modelFastOption(snapshot) : undefined
  const fastEnabled =
    fastOption && isFastModeEnabled(fastOption, configValues[fastOption.id])

  return (
    <div
      className={cn(
        inline
          ? "flex flex-wrap items-center gap-x-3 gap-y-1.5"
          : "flex flex-col gap-2.5 rounded-lg border border-border bg-card/40 p-3"
      )}
    >
      {showMode && snapshot.modes ? (
        <div className="flex min-w-0 items-center justify-between gap-3">
          {!inline && <span className="text-sm">{t("mode")}</span>}
          <AgentModePicker
            label={t("mode")}
            value={modeId}
            modes={vocabulary.modes(snapshot.modes.available_modes)}
            current={snapshot.modes.current_mode_id}
            inheritLabel={inline ? undefined : t("inherit")}
            showHint={inline}
            onChange={onModeChange}
          />
        </div>
      ) : null}
      {snapshot.config_options
        .filter(
          (option) => option.kind.type === "select" && option !== fastOption
        )
        .map((option) => {
          const localized = vocabulary.configOption(option)
          return (
            <div
              key={option.id}
              className="flex min-w-0 items-center justify-between gap-3"
            >
              {!inline && <span className="text-sm">{localized.name}</span>}
              <AgentOptionPicker
                option={localized}
                footer={
                  fastOption && isModelConfigOption(option) ? (
                    <ModelFastMode
                      option={vocabulary.configOption(fastOption)}
                      checked={fastEnabled}
                      onSelect={onConfigChange}
                    />
                  ) : undefined
                }
                triggerSuffix={
                  fastEnabled && isModelConfigOption(option)
                    ? " · Fast"
                    : undefined
                }
                value={configValues[option.id] ?? null}
                inheritLabel={inline ? undefined : t("inherit")}
                showHint={inline}
                onChange={(value) => onConfigChange(option.id, value)}
              />
            </div>
          )
        })}
    </div>
  )
}

/**
 * The inline picker fallback (`value ?? currentValue`) applied across a
 * whole snapshot: the concrete selections the inline (no-inherit) config bar is
 * *displaying*. The editor saves these so a saved automation pins exactly what
 * the user saw — an untouched option persists the agent's current value rather
 * than an empty override that would silently inherit a future default.
 */
export function effectiveSelections(
  snapshot: AgentOptionsSnapshot | null,
  modeId: string | null,
  configValues: Record<string, string>
): { mode_id: string | null; config_values: Record<string, string> } {
  // No probe landed → nothing concrete was ever shown; persist the raw overrides.
  if (!snapshot) return { mode_id: modeId, config_values: configValues }

  const config: Record<string, string> = {}
  const fast = modelFastOption(snapshot)
  if (fast?.kind.type === "boolean")
    config[fast.id] = configValues[fast.id] ?? String(fast.kind.current_value)
  for (const option of snapshot.config_options) {
    if (option.kind.type !== "select") continue
    const effective = configValues[option.id] ?? option.kind.current_value
    if (effective != null && effective !== "") config[option.id] = effective
  }
  // Defensive: never drop a user override for an option this snapshot doesn't
  // advertise (e.g. a stale id from an earlier probe of another agent).
  for (const [id, value] of Object.entries(configValues)) {
    if (!(id in config)) config[id] = value
  }

  // Mirror `showMode = hasModes && !hasOptions`: the standalone mode row is only
  // shown — and thus only pinnable — when the agent has modes but no config
  // options; otherwise leave the user's mode choice (incl. null) untouched.
  const hasModes = !!snapshot.modes && snapshot.modes.available_modes.length > 0
  const hasOptions = snapshot.config_options.length > 0
  const mode_id =
    modeId ?? (hasModes && !hasOptions ? snapshot.modes!.current_mode_id : null)

  return { mode_id, config_values: config }
}

// Friendly name for a selected value within a select option — checks groups
// first, then the flat list, mirroring how ConfigOptionRow renders them.
function selectValueLabel(
  kind: Extract<SessionConfigOptionInfo["kind"], { type: "select" }>,
  value: string
): string | undefined {
  for (const group of kind.groups) {
    const hit = group.options.find((o) => o.value === value)
    if (hit) return hit.name
  }
  return kind.options.find((o) => o.value === value)?.name
}

/**
 * Human-readable labels for the effective selections, captured at save time so
 * the detail page shows friendly names (model/mode/option) instead of raw value
 * ids — and keeps showing them even if the agent is later uninstalled or its
 * option set changes. Pass the same effective `{ mode_id, config_values }` that
 * `effectiveSelections` produced. Returns only the fields it can resolve.
 */
export function snapshotLabels(
  snapshot: AgentOptionsSnapshot | null,
  modeId: string | null,
  configValues: Record<string, string>
): { mode_label?: string; config_labels?: Record<string, string> } {
  if (!snapshot) return {}
  const out: { mode_label?: string; config_labels?: Record<string, string> } =
    {}

  if (modeId && snapshot.modes) {
    const mode = snapshot.modes.available_modes.find((m) => m.id === modeId)
    if (mode) out.mode_label = mode.name
  }

  const config_labels: Record<string, string> = {}
  for (const option of snapshot.config_options) {
    if (option.kind.type !== "select") continue
    const value = configValues[option.id]
    if (value == null) continue
    const name = selectValueLabel(option.kind, value)
    if (name) config_labels[option.id] = name
  }
  if (Object.keys(config_labels).length > 0) out.config_labels = config_labels

  return out
}
