"use client"

/**
 * Desktop-notification settings — the master switch, when a notification may
 * interrupt, whether its body may carry agent output, and which events raise
 * one at all.
 *
 * Shaped like its neighbour `notification-sound-settings.tsx` (same section
 * grammar, same localStorage-backed write-through with no Save button) because
 * the two are read as one pair: "how does Codeg get my attention".
 *
 * The permission card is where they diverge, and it is the reason this section
 * exists. Permission is only a real, three-valued thing in a browser; on the
 * desktop the OS owns it and gives the app no way to read it back. The card
 * therefore renders one of two entirely different things rather than a lowest
 * common denominator that would be a lie on one of the platforms.
 */

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Bell,
  BellRing,
  Clock,
  EyeOff,
  ExternalLink,
  ListChecks,
  Loader2,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

import { SettingCard, SettingRow } from "@/components/shared/setting-card"
import { SettingsSection } from "@/components/shared/settings-section"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { sendTestNotification } from "@/lib/desktop-notification"
import {
  NOTIFY_EVENT_IDS,
  NOTIFY_WHEN_IDS,
  saveDesktopNotificationPrefs,
  useDesktopNotificationPrefs,
  type NotifyEventId,
  type NotifyWhen,
} from "@/lib/desktop-notification-prefs"
import {
  getNotificationPermission,
  openSystemNotificationSettings,
  requestNotificationPermission,
  type NotificationPermissionState,
} from "@/lib/notification"
import { toErrorMessage } from "@/lib/app-error"

// Literal message keys per id — next-intl only resolves literal keys, so the
// lookup tables keep the rows data-driven without losing key checking.
//
// The first four reuse the chat-channel Events tab's names, exactly as the
// sound panel does, so one trigger reads identically everywhere it is
// configurable. The last two have no channel counterpart (they are app-level,
// not ACP events) and carry their own labels.
const CHANNEL_EVENT_LABEL_KEYS = {
  turn_complete: "turnComplete",
  permission_request: "permissionRequest",
  question_request: "questionRequest",
  error: "error",
} as const

const LOCAL_EVENT_LABEL_KEYS = {
  background_task: "eventBackgroundTask",
  work_task: "eventWorkTask",
} as const

const WHEN_LABEL_KEYS = {
  always: "whenAlways",
  unfocused: "whenUnfocused",
  hidden: "whenHidden",
} as const satisfies Record<NotifyWhen, string>

const PERMISSION_LABEL_KEYS = {
  granted: "permissionGranted",
  denied: "permissionDenied",
  default: "permissionDefault",
  unsupported: "permissionUnsupported",
  managed_by_os: "permissionManagedByOs",
} as const satisfies Record<NotificationPermissionState, string>

/** What each state means, and what the user can do about it. */
const PERMISSION_HINT_KEYS = {
  granted: "permissionGrantedHint",
  denied: "permissionDeniedHint",
  default: "permissionDefaultHint",
  unsupported: "permissionUnsupportedHint",
  managed_by_os: "permissionManagedByOsHint",
} as const satisfies Record<NotificationPermissionState, string>

export function DesktopNotificationSettingsSection() {
  const t = useTranslations("DesktopNotificationSettings")
  const tEvents = useTranslations("ChatChannelSettings.events")

  const prefs = useDesktopNotificationPrefs()

  // Read after mount only. The static export renders without a browser, so
  // reading `Notification.permission` during the first pass would make the
  // server and client markup disagree; `null` is the "not known yet" state and
  // renders nothing rather than a wrong badge.
  const [permission, setPermission] =
    useState<NotificationPermissionState | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [testing, setTesting] = useState(false)

  // Always folded on arrival, however the master switch is set: this is one of
  // several sections on the General tab, and a page that opens with every knob
  // on screen is one nobody can scan.
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setPermission(getNotificationPermission())
  }, [])

  // With notifications off there is nothing under the heading to fold, so the
  // section stays the plain one-liner it already was rather than growing a
  // chevron that opens onto an empty box.

  const onRequestPermission = useCallback(async () => {
    setRequesting(true)
    try {
      // Called directly out of the click handler: browsers only honour a
      // permission request that carries user activation, and awaiting anything
      // first would spend it.
      const next = await requestNotificationPermission()
      setPermission(next)
      if (next === "granted") toast.success(t("permissionGrantedToast"))
      else if (next === "denied") toast.error(t("permissionDeniedToast"))
    } finally {
      setRequesting(false)
    }
  }, [t])

  const onSendTest = useCallback(async () => {
    setTesting(true)
    try {
      await sendTestNotification(t("testTitle"), t("testBody"))
      toast.success(t("testSent"))
    } catch (err) {
      toast.error(t("testFailed"), { description: toErrorMessage(err) })
    } finally {
      setTesting(false)
      // A browser can revoke permission from its own UI while this page is
      // open, and a failed send is the first moment we'd notice.
      setPermission(getNotificationPermission())
    }
  }, [t])

  const onOpenSystemSettings = useCallback(async () => {
    try {
      await openSystemNotificationSettings()
    } catch (err) {
      toast.error(t("openSystemSettingsFailed"), {
        description: toErrorMessage(err),
      })
    }
  }, [t])

  const eventLabel = (eventId: NotifyEventId): string =>
    eventId in CHANNEL_EVENT_LABEL_KEYS
      ? tEvents(
          CHANNEL_EVENT_LABEL_KEYS[
            eventId as keyof typeof CHANNEL_EVENT_LABEL_KEYS
          ]
        )
      : t(
          LOCAL_EVENT_LABEL_KEYS[eventId as keyof typeof LOCAL_EVENT_LABEL_KEYS]
        )

  return (
    // The master switch is the section's heading row: with notifications off
    // the whole section is that one line, and the knobs it gates appear under
    // it rather than in a card repeating "Enable desktop notifications". With
    // them on the heading also folds those knobs away, and starts folded.
    <SettingsSection
      icon={Bell}
      title={t("title")}
      description={t("description")}
      // Only labels the switch while there is nothing to fold; once the
      // heading is the disclosure button the switch names itself instead.
      htmlFor="desktop-notification-enabled"
      collapsible
      open={expanded}
      onOpenChange={setExpanded}
      control={
        <Switch
          id="desktop-notification-enabled"
          aria-label={t("title")}
          checked={prefs.enabled}
          onCheckedChange={(enabled) => {
            saveDesktopNotificationPrefs({ ...prefs, enabled })
            // Switching it on is a request to see what it does, so unfold in
            // the same gesture. Only here, never on mount: arriving at the tab
            // is not that request.
            if (enabled) setExpanded(true)
          }}
        />
      }
    >
      {prefs.enabled && permission !== null && (
        <SettingCard>
          <SettingRow
            icon={ShieldCheck}
            title={t("permissionTitle")}
            description={t(PERMISSION_HINT_KEYS[permission])}
            control={
              <span className="shrink-0 rounded-md border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
                {t(PERMISSION_LABEL_KEYS[permission])}
              </span>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              {/* Only offered while the browser is still undecided. Once it has
                  answered, the prompt cannot be raised again from script —
                  showing the button anyway would be a control that silently
                  does nothing. */}
              {permission === "default" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-background"
                  disabled={requesting}
                  onClick={() => void onRequestPermission()}
                >
                  {requesting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <BellRing className="h-3.5 w-3.5" />
                  )}
                  {t("requestPermission")}
                </Button>
              )}
              {permission === "managed_by_os" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-background"
                  onClick={() => void onOpenSystemSettings()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("openSystemSettings")}
                </Button>
              )}
              {/* The only end-to-end evidence available on desktop, where
                  there is no permission to read back. */}
              {permission !== "unsupported" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="bg-background"
                  disabled={testing}
                  onClick={() => void onSendTest()}
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Bell className="h-3.5 w-3.5" />
                  )}
                  {t("sendTest")}
                </Button>
              )}
            </div>
          </SettingRow>
        </SettingCard>
      )}

      {prefs.enabled && (
        <SettingCard>
          <SettingRow
            icon={Clock}
            title={t("whenTitle")}
            description={t("whenHint")}
            control={
              <Select
                value={prefs.when}
                onValueChange={(value) =>
                  saveDesktopNotificationPrefs({
                    ...prefs,
                    when: value as NotifyWhen,
                  })
                }
              >
                {/* `size` rather than a bare `h-8`: the trigger's own height is
                    gated on `data-size`, which outranks an ungated utility. */}
                <SelectTrigger
                  size="sm"
                  className="w-44 bg-background text-xs"
                  aria-label={t("whenTitle")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {NOTIFY_WHEN_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      {t(WHEN_LABEL_KEYS[id])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />

          <SettingRow
            icon={EyeOff}
            title={t("hideBody")}
            description={t("hideBodyHint")}
            htmlFor="desktop-notification-hide-body"
            control={
              <Switch
                id="desktop-notification-hide-body"
                checked={prefs.hideBody}
                onCheckedChange={(hideBody) =>
                  saveDesktopNotificationPrefs({ ...prefs, hideBody })
                }
              />
            }
          />

          {/* The per-event switches are one setting with many values, so they
              are a single row whose control is the list — not one row per
              event, which would repeat the same explanation six times. */}
          <SettingRow
            icon={ListChecks}
            title={t("eventsTitle")}
            description={t("eventsHint")}
          >
            <div className="space-y-1.5">
              {NOTIFY_EVENT_IDS.map((eventId) => {
                const label = eventLabel(eventId)
                return (
                  <div
                    key={eventId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm">{label}</span>
                    <Switch
                      className="shrink-0"
                      checked={prefs.events[eventId]}
                      aria-label={label}
                      onCheckedChange={(checked) =>
                        saveDesktopNotificationPrefs({
                          ...prefs,
                          events: { ...prefs.events, [eventId]: checked },
                        })
                      }
                    />
                  </div>
                )
              })}
            </div>
          </SettingRow>
        </SettingCard>
      )}
    </SettingsSection>
  )
}
