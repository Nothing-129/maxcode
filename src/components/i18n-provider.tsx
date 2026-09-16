"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { getFallbackMessages, getMessagesForLocale } from "@/i18n/messages"
import {
  fromIntlLocale,
  getSystemLocaleCandidates,
  LANGUAGE_COOKIE_KEY,
  LANGUAGE_MODE_COOKIE_KEY,
  LANGUAGE_SETTINGS_STORAGE_KEY,
  normalizeLanguageSettings,
  resolveAppLocale,
  toIntlLocale,
  type IntlLocale,
} from "@/lib/i18n"
import { getSystemLanguageSettings } from "@/lib/api"
import { AppBootLoading } from "@/components/layout/app-boot-loading"
import type { AppLocale, SystemLanguageSettings } from "@/lib/types"

interface AppI18nContextValue {
  appLocale: AppLocale
  languageSettings: SystemLanguageSettings
  languageSettingsLoaded: boolean
  setLanguageSettings: (settings: SystemLanguageSettings) => void
}

const AppI18nContext = createContext<AppI18nContextValue | null>(null)

function subscribeSystemLocale(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {}

  window.addEventListener("languagechange", onStoreChange)
  return () => {
    window.removeEventListener("languagechange", onStoreChange)
  }
}

function getSystemLocaleSnapshot(): string {
  return getSystemLocaleCandidates().join("|")
}

function getSystemLocaleServerSnapshot(): string {
  return ""
}

function persistLanguageSettings(settings: SystemLanguageSettings) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(
      LANGUAGE_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings)
    )
  } catch {
    // Ignore write failures (e.g. disabled storage).
  }
}

function persistLanguageCookies(
  settings: SystemLanguageSettings,
  appLocale: AppLocale
) {
  if (typeof document === "undefined") return

  const maxAge = 60 * 60 * 24 * 365
  document.cookie = `${LANGUAGE_MODE_COOKIE_KEY}=${settings.mode}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
  document.cookie = `${LANGUAGE_COOKIE_KEY}=${toIntlLocale(appLocale)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
}

export function useAppI18n() {
  const context = useContext(AppI18nContext)
  if (!context) {
    throw new Error("useAppI18n must be used within AppI18nProvider")
  }
  return context
}

interface AppI18nProviderProps {
  children: React.ReactNode
  initialLocale?: IntlLocale
  initialMessages?: AbstractIntlMessages
}

export function AppI18nProvider({
  children,
  initialLocale = "en",
  initialMessages,
}: AppI18nProviderProps) {
  const initialAppLocale = fromIntlLocale(initialLocale)
  const [languageSettings, setLanguageSettingsState] =
    useState<SystemLanguageSettings>({
      mode: "manual",
      language: initialAppLocale,
    })
  const [languageSettingsLoaded, setLanguageSettingsLoaded] = useState(false)
  const [messages, setMessages] = useState<AbstractIntlMessages>(
    initialMessages ?? getFallbackMessages()
  )
  const [messagesLocale, setMessagesLocale] = useState<AppLocale>(
    initialMessages ? initialAppLocale : "en"
  )

  const systemLocaleSnapshot = useSyncExternalStore(
    subscribeSystemLocale,
    getSystemLocaleSnapshot,
    getSystemLocaleServerSnapshot
  )
  const systemLocaleCandidates = useMemo(
    () => (systemLocaleSnapshot ? systemLocaleSnapshot.split("|") : []),
    [systemLocaleSnapshot]
  )

  const setLanguageSettings = useCallback(
    (settings: SystemLanguageSettings) => {
      const normalized = normalizeLanguageSettings(settings)
      setLanguageSettingsState(normalized)
      persistLanguageSettings(normalized)
    },
    []
  )

  useEffect(() => {
    if (typeof window === "undefined") return

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LANGUAGE_SETTINGS_STORAGE_KEY || !event.newValue) return

      try {
        const next = normalizeLanguageSettings(
          JSON.parse(event.newValue) as SystemLanguageSettings
        )
        setLanguageSettingsState(next)
      } catch {
        // Ignore malformed storage payloads.
      }
    }

    window.addEventListener("storage", onStorage)

    return () => {
      window.removeEventListener("storage", onStorage)
    }
  }, [setLanguageSettings])

  useEffect(() => {
    let cancelled = false

    getSystemLanguageSettings()
      .then((settings) => {
        if (cancelled) return
        setLanguageSettings(settings)
      })
      .catch((err) => {
        console.error("[i18n] load language settings failed:", err)
      })
      .finally(() => {
        if (!cancelled) {
          setLanguageSettingsLoaded(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [setLanguageSettings])

  const appLocale = useMemo(
    () => resolveAppLocale(languageSettings, systemLocaleCandidates),
    [languageSettings, systemLocaleCandidates]
  )

  useEffect(() => {
    if (!languageSettingsLoaded) return
    persistLanguageCookies(languageSettings, appLocale)
  }, [appLocale, languageSettings, languageSettingsLoaded])

  useEffect(() => {
    if (appLocale === messagesLocale) {
      return
    }
    let cancelled = false

    getMessagesForLocale(appLocale)
      .then((nextMessages) => {
        if (!cancelled) {
          setMessages(nextMessages)
          setMessagesLocale(appLocale)
        }
      })
      .catch((err) => {
        console.error("[i18n] load locale messages failed:", err)
      })

    return () => {
      cancelled = true
    }
  }, [appLocale, messagesLocale])

  const localeReady = appLocale === messagesLocale
  const appReady = languageSettingsLoaded && localeReady
  const activeIntlLocale = toIntlLocale(messagesLocale)

  useEffect(() => {
    document.documentElement.lang = activeIntlLocale
    document.documentElement.dir = activeIntlLocale === "ar" ? "rtl" : "ltr"
  }, [activeIntlLocale])

  const contextValue = useMemo<AppI18nContextValue>(
    () => ({
      appLocale,
      languageSettings,
      languageSettingsLoaded,
      setLanguageSettings,
    }),
    [appLocale, languageSettings, languageSettingsLoaded, setLanguageSettings]
  )

  return (
    <AppI18nContext.Provider value={contextValue}>
      <NextIntlClientProvider locale={activeIntlLocale} messages={messages}>
        {appReady ? children : <AppBootLoading />}
      </NextIntlClientProvider>
    </AppI18nContext.Provider>
  )
}
