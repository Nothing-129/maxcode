"use client"

import { useTranslations } from "next-intl"
import { useSidebarNavigation } from "@/contexts/sidebar-navigation-context"
import { SidebarSectionOrderControl } from "./sidebar-section-order-control"

export function SidebarNavigationOrderControl() {
  const navigation = useSidebarNavigation()
  const t = useTranslations("Folder.sidebar.navigation")
  if (!navigation) return null
  return (
    <SidebarSectionOrderControl
      keyboardMoves={false}
      order={navigation.order}
      onMove={navigation.moveNavigation}
      getLabel={(id) => t(id)}
    />
  )
}
