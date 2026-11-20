"use client"

import { SettingsHelp } from "@/components/shared/settings-help"
import { useTranslations } from "next-intl"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChannelListTab } from "./channel-list-tab"
import { ChannelCommandsTab } from "./channel-commands-tab"
import { ChannelEventsTab } from "./channel-events-tab"
import { ChannelOtherTab } from "./channel-other-tab"

export function ChatChannelSettings() {
  const t = useTranslations("ChatChannelSettings")

  return (
    <ScrollArea className="h-full">
      <Tabs
        data-settings-page=""
        defaultValue="channels"
        className="w-full space-y-4 p-3 md:p-4"
      >
        <section className="space-y-3">
          <div>
            <div className="settings-help-heading flex items-center gap-1">
              <h1 data-settings-page-title="">{t("sectionTitle")}</h1>
              <SettingsHelp label={t("sectionTitle")}>
                {t("sectionDescription")}
              </SettingsHelp>
            </div>
          </div>
          <TabsList variant="line" className="max-w-full flex-wrap">
            <TabsTrigger value="channels">{t("tabs.channels")}</TabsTrigger>
            <TabsTrigger value="commands">{t("tabs.commands")}</TabsTrigger>
            <TabsTrigger value="events">{t("tabs.events")}</TabsTrigger>
            <TabsTrigger value="other">{t("tabs.other")}</TabsTrigger>
          </TabsList>
        </section>

        <TabsContent value="channels" className="mt-0">
          <ChannelListTab />
        </TabsContent>
        <TabsContent value="commands" className="mt-0">
          <ChannelCommandsTab />
        </TabsContent>
        <TabsContent value="events" className="mt-0">
          <ChannelEventsTab />
        </TabsContent>
        <TabsContent value="other" className="mt-0">
          <ChannelOtherTab />
        </TabsContent>
      </Tabs>
    </ScrollArea>
  )
}
