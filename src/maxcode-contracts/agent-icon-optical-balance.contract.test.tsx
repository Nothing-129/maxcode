import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AgentIcon } from "@/components/agent-icon"

describe("Maintained agent icon optical balance", () => {
  it.each(["size-3", "size-4"])(
    "preserves %s layout boxes around optically balanced marks",
    (className) => {
      for (const agentType of [
        "claude_code",
        "codex",
        "grok",
        "pi",
        "deepseek",
        "antigravity",
        "zcode",
      ] as const) {
        const { container, unmount } = render(
          <AgentIcon agentType={agentType} className={className} />
        )
        expect(container.firstChild).toHaveClass(className, "shrink-0")
        const svg = container.querySelector("svg")
        const img = container.querySelector("img")
        if (svg) {
          expect(svg).toHaveAttribute("width", "100%")
          expect(svg).toHaveAttribute("height", "100%")
        } else {
          expect(img).toHaveStyle({ width: "100%", height: "100%" })
        }
        if (agentType === "claude_code") {
          expect(svg).toHaveAttribute("viewBox", "0 0.5 24 24")
        }
        if (agentType === "grok") {
          expect(img).toHaveStyle({ transform: "scale(0.92)" })
        }
        if (agentType === "zcode") {
          expect(svg).toHaveAttribute("viewBox", "-1 -1 26 26")
        }
        unmount()
      }
    }
  )
})
