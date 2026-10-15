"use client"

/**
 * The extra tools codeg hands an agent inside a conversation, as one panel:
 * live feedback, ask-user-question, get-session-info, and automation creation.
 * The historical work-task writer flag is retained in persisted settings,
 * while its switch stays hidden with the retired AI task board.
 *
 * They used to be four sections, each with its own heading, description, card
 * and Save bar: four times the chrome for five switches, which is what made
 * `/settings/general` read as far longer than it configures.
 *
 * Persistence stays split the way the backend has it — `feedback.enabled`,
 * `question.enabled`, `session_info.enabled` and `chat_authoring.*` remain four
 * endpoints. Save writes only the groups whose value actually moved, so a
 * failing endpoint can't roll back its neighbours, and a group whose *load*
 * failed (its switch is showing a default, not what is stored) is left alone
 * unless the user touched it.
 */

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  CalendarClock,
  HelpCircle,
  MessageSquare,
  MessageSquarePlus,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { SettingCard, SettingRow } from "@/components/shared/setting-card"
import {
  SettingsError,
  SettingsSaveBar,
  SettingsSection,
} from "@/components/shared/settings-section"
import { Switch } from "@/components/ui/switch"
import {
  getChatAuthoringSettings,
  getFeedbackSettings,
  getQuestionSettings,
  getSessionInfoSettings,
  setChatAuthoringSettings,
  setFeedbackSettings,
  setQuestionSettings,
  setSessionInfoSettings,
} from "@/lib/api"
import { toErrorMessage } from "@/lib/app-error"
import { primeFeedbackEnabled } from "@/hooks/use-feedback-enabled"

/** One field per switch, flattened across the four backend groups. */
interface AgentToolValues {
  feedback: boolean
  question: boolean
  sessionInfo: boolean
  automations: boolean
  workTasks: boolean
}

/**
 * What the switches show until the load lands — and what a group that failed to
 * load keeps showing. Mirrors the Rust-side defaults (the two read-only lookups
 * ship on; feedback and the two writers ship off), so the panel doesn't flip
 * under the user a beat after it opens.
 */
const DEFAULTS: AgentToolValues = {
  feedback: false,
  question: true,
  sessionInfo: true,
  automations: false,
  workTasks: false,
}

// Literal message keys per row — next-intl only resolves literal keys, so the
// table keeps the rows data-driven without losing key checking.
const TOOL_ROWS = [
  {
    key: "feedback",
    id: "agent-tools-feedback",
    icon: MessageSquarePlus,
    label: "feedbackLabel",
    hint: "feedbackHint",
  },
  {
    key: "question",
    id: "agent-tools-question",
    icon: HelpCircle,
    label: "questionLabel",
    hint: "questionHint",
  },
  {
    key: "sessionInfo",
    id: "agent-tools-session-info",
    icon: MessageSquare,
    label: "sessionInfoLabel",
    hint: "sessionInfoHint",
  },
  {
    key: "automations",
    id: "agent-tools-automations",
    icon: CalendarClock,
    label: "automationsLabel",
    hint: "automationsHint",
  },
] as const satisfies ReadonlyArray<{
  key: keyof AgentToolValues
  id: string
  icon: LucideIcon
  label: string
  hint: string
}>

export function AgentToolsSettingsSection() {
  const t = useTranslations("AgentToolsSettings")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState<AgentToolValues>(DEFAULTS)
  // Last known-good values: set from a successful load, and per group from a
  // successful write. The diff against `values` is what Save acts on.
  const [baseline, setBaseline] = useState<AgentToolValues>(DEFAULTS)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [feedback, question, sessionInfo, chat] = await Promise.allSettled([
        getFeedbackSettings(),
        getQuestionSettings(),
        getSessionInfoSettings(),
        getChatAuthoringSettings(),
      ])
      if (cancelled) return

      // One endpoint being down shouldn't blank the other four switches, so
      // each group lands on its own and only the failures are reported.
      const next = { ...DEFAULTS }
      const failures: string[] = []
      if (feedback.status === "fulfilled")
        next.feedback = feedback.value.enabled
      else failures.push(toErrorMessage(feedback.reason))
      if (question.status === "fulfilled")
        next.question = question.value.enabled
      else failures.push(toErrorMessage(question.reason))
      if (sessionInfo.status === "fulfilled")
        next.sessionInfo = sessionInfo.value.enabled
      else failures.push(toErrorMessage(sessionInfo.reason))
      if (chat.status === "fulfilled") {
        next.automations = chat.value.automations_enabled
        next.workTasks = chat.value.work_tasks_enabled
      } else failures.push(toErrorMessage(chat.reason))

      setValues(next)
      setBaseline(next)
      setLoadError(failures.length > 0 ? failures.join("; ") : null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const dirty =
    values.feedback !== baseline.feedback ||
    values.question !== baseline.question ||
    values.sessionInfo !== baseline.sessionInfo ||
    values.automations !== baseline.automations ||
    values.workTasks !== baseline.workTasks

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const writes: Array<Promise<Partial<AgentToolValues>>> = []

      if (values.feedback !== baseline.feedback) {
        writes.push(
          setFeedbackSettings({ enabled: values.feedback }).then((applied) => {
            // Refresh the module-cached flag so open conversations show/hide
            // the feedback bar without a full reload.
            primeFeedbackEnabled(applied.enabled)
            return { feedback: applied.enabled }
          })
        )
      }
      if (values.question !== baseline.question) {
        writes.push(
          setQuestionSettings({ enabled: values.question }).then((applied) => ({
            question: applied.enabled,
          }))
        )
      }
      if (values.sessionInfo !== baseline.sessionInfo) {
        writes.push(
          setSessionInfoSettings({ enabled: values.sessionInfo }).then(
            (applied) => ({ sessionInfo: applied.enabled })
          )
        )
      }
      if (
        values.automations !== baseline.automations ||
        values.workTasks !== baseline.workTasks
      ) {
        writes.push(
          setChatAuthoringSettings({
            automations_enabled: values.automations,
            work_tasks_enabled: values.workTasks,
          }).then((applied) => ({
            automations: applied.automations_enabled,
            workTasks: applied.work_tasks_enabled,
          }))
        )
      }

      const results = await Promise.allSettled(writes)
      // Mirror what each endpoint actually persisted (it may clamp or filter)
      // and promote it to the new baseline; a group that failed keeps its old
      // baseline, so the next Save retries exactly that group.
      const applied = results.reduce<Partial<AgentToolValues>>(
        (acc, result) =>
          result.status === "fulfilled" ? { ...acc, ...result.value } : acc,
        {}
      )
      setValues((prev) => ({ ...prev, ...applied }))
      setBaseline((prev) => ({ ...prev, ...applied }))

      const failures = results
        .filter((result) => result.status === "rejected")
        .map((result) => toErrorMessage(result.reason))
      if (failures.length > 0) {
        toast.error(t("saveFailed"), { description: failures.join("; ") })
      } else {
        toast.success(t("saved"))
      }
    } finally {
      setSaving(false)
    }
  }, [values, baseline, t])

  return (
    <SettingsSection
      icon={Wrench}
      title={t("title")}
      description={t("description")}
    >
      {loadError && (
        <SettingsError>{t("loadFailed", { detail: loadError })}</SettingsError>
      )}

      {/* One card, because these are one decision split by which surface the
          agent reaches: the conversation, or the app state behind it. */}
      <SettingCard>
        {TOOL_ROWS.map((row) => (
          <SettingRow
            key={row.key}
            icon={row.icon}
            title={t(row.label)}
            description={t(row.hint)}
            htmlFor={row.id}
            control={
              <Switch
                id={row.id}
                checked={values[row.key]}
                onCheckedChange={(next) =>
                  setValues((prev) => ({ ...prev, [row.key]: next }))
                }
                disabled={loading}
              />
            }
          />
        ))}
      </SettingCard>

      <SettingsSaveBar
        onSave={() => void save()}
        saving={saving}
        disabled={loading || !dirty}
        label={t("save")}
        savingLabel={t("saving")}
      />
    </SettingsSection>
  )
}
