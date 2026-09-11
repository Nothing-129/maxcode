import { act, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SidebarWordmark } from "@/components/layout/sidebar-wordmark"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import type { DbConversationSummary } from "@/lib/types"
import { source } from "./contract-source"

function setStatuses(...statuses: string[]) {
  act(() => {
    useAppWorkspaceStore.setState({
      conversations: statuses.map(
        (status, id): DbConversationSummary => ({
          id,
          folder_id: id + 1,
          title: null,
          title_locked: false,
          agent_type: "claude_code",
          kind: "regular",
          status,
          model: null,
          git_branch: null,
          external_id: null,
          message_count: 0,
          child_count: 0,
          created_at: "2026-09-09T00:00:00Z",
          updated_at: "2026-09-09T00:00:00Z",
          pinned_at: null,
        })
      ),
    })
  })
}

describe("MaxCode contract: sidebar wordmark", () => {
  afterEach(() => setStatuses())

  it("shows the gradient while any folder has work, then settles on completion or cancellation", () => {
    setStatuses("completed", "pending_review")
    const { container } = render(<SidebarWordmark />)
    const working = () =>
      container.querySelector("svg")?.getAttribute("data-working")
    expect(working()).toBe("false")
    setStatuses("in_progress", "in_progress")
    expect(working()).toBe("true")
    setStatuses("completed", "in_progress")
    expect(working()).toBe("true")
    setStatuses("completed", "cancelled")
    expect(working()).toBe("false")
    setStatuses("pending", "pending_review", "failed")
    expect(working()).toBe("false")
    setStatuses()
    expect(working()).toBe("false")
  })

  it("keeps reduced-motion users static and fades only the slash overlay", () => {
    const css = source("src/components/layout/sidebar-wordmark.module.css")
    expect(css).toContain("gradientFlow 3.6s linear infinite")
    expect(css).toContain(
      "blueBreath 1.8s cubic-bezier(0.45, 0, 0.55, 1) infinite"
    )
    expect(css).toContain("transition: opacity 300ms ease")
    const reducedMotion = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)")
    )
    expect(reducedMotion).toContain("display: none")
    expect(reducedMotion).toContain("transition: none")
    expect(reducedMotion).toContain("animation: none")
    expect(reducedMotion).toContain('.slash[data-working="true"],')
  })

  it("enlarges the wordmark and keeps the breathing gradient free of glow or light bands", () => {
    setStatuses("in_progress")
    const { container } = render(<SidebarWordmark />)
    const slash = container.querySelector("svg")!
    expect(slash.classList.contains("h-7")).toBe(true)
    expect(slash.classList.contains("w-3.5")).toBe(true)
    expect(screen.getByText("Max").classList.contains("text-[24px]")).toBe(true)
    expect(screen.getByText("Code").classList.contains("text-[22px]")).toBe(
      true
    )
    expect(container.querySelector("path[stroke-dasharray]")).toBeNull()
    const css = source("src/components/layout/sidebar-wordmark.module.css")
    expect(css).not.toContain("drop-shadow")
    expect(css).toContain("transform: scaleY(0.82)")
    expect(css).toContain("transform: scaleY(1.08)")
  })

  it("gives each wordmark its own three-color gradient without changing the base stroke", () => {
    const { container } = render(
      <>
        <SidebarWordmark />
        <SidebarWordmark />
      </>
    )
    const ids = new Set<string>()
    for (const svg of container.querySelectorAll("svg")) {
      for (const path of svg.querySelectorAll("path")) {
        expect(path.getAttribute("stroke-width")).toBe("4.2")
        expect(path.getAttribute("stroke-linecap")).toBe("round")
      }
      const gradient = svg.querySelector("linearGradient")!
      ids.add(gradient.id)
      expect(gradient.querySelectorAll("stop")).toHaveLength(3)
      expect(svg.querySelector("path")?.getAttribute("stroke")).toBe(
        "currentColor"
      )
      expect(svg.querySelector("g path")?.getAttribute("stroke")).toBe(
        `url(#${gradient.id})`
      )
    }
    expect(ids.size).toBe(2)
  })

  it("preserves the selected cobalt palette for light and dark sidebars", () => {
    const { container } = render(<SidebarWordmark />)
    const slash = container.querySelector("svg")
    expect(slash?.classList.contains("text-[#285ee1]")).toBe(true)
    expect(slash?.classList.contains("dark:text-[#82a4ff]")).toBe(true)
  })

  it("exposes one product name without adding a navigation stop", () => {
    const { container } = render(<SidebarWordmark />)
    expect(screen.getByRole("img", { name: "MaxCode" })).toBeTruthy()
    expect(container.textContent).toBe("MaxCode")
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    )
    expect(container.querySelector("svg")?.getAttribute("focusable")).toBe(
      "false"
    )
    expect(container.querySelector("a, button, [tabindex]")).toBeNull()
  })
})
