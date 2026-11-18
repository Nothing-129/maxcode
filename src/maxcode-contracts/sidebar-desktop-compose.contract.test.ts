import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("desktop sidebar compose action", () => {
  it("keeps the shared 13px typography with a slightly stronger compose action", () => {
    expect(source("src/components/layout/sidebar.tsx")).toContain(
      "text-[0.8125rem] font-medium leading-5 tracking-normal text-[#404040] dark:text-sidebar-foreground"
    )
  })
  it("places both primary actions in the same horizontal row so flex-1 sizes width", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    const row =
      sidebar.match(/<div data-sidebar-actions[^>]*>([\s\S]*?)<\/div>/)?.[1] ??
      ""
    expect(row).toContain('label={t("newChat")}')
    expect(row).toContain('label={t("navigation.todoBoard")}')
  })
  it("gives compose and todo board equally stronger text and original icons", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toContain('icon !== "clock" && "font-semibold"')
    expect(sidebar).toContain(
      'icon !== "clock" && "size-4 text-current [stroke-width:1.75]"'
    )
    expect(sidebar).toContain("<SidebarNavigationIcon")
  })
  it("renders compose and task board as left-aligned text actions on desktop", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toMatch(
      /icon="compose"\s+variant=\{isMobile \? "filled" : "ghost"\}/
    )
    expect(sidebar).toMatch(
      /icon="tasks"\s+variant=\{isMobile \? "filled" : "ghost"\}/
    )
    expect(sidebar.replace(/\s+/g, " ")).toContain(
      'variant === "ghost" && "justify-start gap-2.5 bg-transparent px-2.5"'
    )
    expect(sidebar).not.toContain("conversationSurface")
  })
  it("retains hover feedback and keyboard focus without a persistent gray fill", () => {
    const sidebar = source("src/components/layout/sidebar.tsx")
    expect(sidebar).toContain(
      "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
    )
    expect(sidebar).toContain("focus-visible:ring-2")
  })
})
