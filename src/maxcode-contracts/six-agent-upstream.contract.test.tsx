import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PermissionDialog } from "@/components/chat/permission-dialog"
import { DropdownRadioItemContent } from "@/components/chat/dropdown-radio-item-content"
import en from "@/i18n/messages/en.json"
import { source } from "./contract-source"

vi.mock("@/components/ai-elements/message", () => ({
  MessageResponse: ({ children }: { children: string }) => (
    <div>{children}</div>
  ),
}))
afterEach(cleanup)

describe("six maintained agents: selected upstream integration", () => {
  it("keeps explicit permission choices while honoring Claude's default-to-no hint", () => {
    const respond = vi.fn()
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PermissionDialog
          agentType="claude_code"
          onRespond={respond}
          permission={{
            request_id: "contract",
            tool_call: {
              title: "Run command",
              kind: "execute",
              _meta: { permission: { version: 1, defaultToNo: true } },
            },
            options: [
              { option_id: "allow", name: "Allow", kind: "allow_once" },
              { option_id: "reject", name: "Reject", kind: "reject_once" },
            ],
          }}
        />
      </NextIntlClientProvider>
    )
    expect(screen.getByRole("button", { name: "Reject" }).className).toContain(
      "bg-primary"
    )
    expect(
      screen.getByRole("button", { name: "Allow" }).className
    ).not.toContain("bg-primary")
    expect(respond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Allow" }))
    expect(respond).toHaveBeenCalledWith("contract", "allow")
  })

  it("adds recommendation text without replacing model labels or descriptions", () => {
    render(
      <DropdownRadioItemContent
        label="My model"
        description="My gateway"
        recommendedLabel="Recommended"
      />
    )
    expect(screen.getByText("My model")).toBeInTheDocument()
    expect(screen.getByText("My gateway")).toBeInTheDocument()
    expect(screen.getByText("Recommended")).toBeInTheDocument()
  })

  it("wires protocol and generation recovery into independent Rust contracts", () => {
    expect(source("src-tauri/src/acp/question.rs")).toContain(
      "codex-question-112.contract.rs"
    )
    expect(
      source("src/maxcode-contracts/codex-question-112.contract.rs")
    ).toContain("ElicitationPeer::Other")
    expect(
      source("src/maxcode-contracts/deepseek-versioned-history.contract.rs")
    ).toContain("newest_generation_preserves_downstream_encoding_migration")
    const registry = source("src-tauri/src/acp/registry.rs")
    for (const pin of [
      "claude-agent-acp@0.78.0",
      "codex-acp@1.12.0",
      "grok@1.0.34",
      "pi-acp@0.0.33",
    ])
      expect(registry).toContain(pin)
  })

  it("keeps Electron lifecycle, official runtimes and connection grace during isolation", () => {
    const server = source("src-tauri/src/bin/codeg_server.rs")
    expect(server).toContain("migrate_legacy_root()")
    expect(server).toContain("scratch_sweep_task()")
    const connection = source("src-tauri/src/acp/connection.rs")
    expect(connection).toContain(
      "agent_auto_updates::managed_runtime(agent_type)"
    )
    expect(connection).toContain("scratch.release()")
    const ui = source("src/components/chat/composer-connection-status.tsx")
    expect(ui).toContain("CONNECTION_STATUS_GRACE_MS")
    expect(ui).toContain("getConnectPending(tabId)")
    expect(source("src/contexts/acp-connections-context.tsx")).toContain(
      "return pendingConnectsRef.current.get(key)"
    )
  })
})
