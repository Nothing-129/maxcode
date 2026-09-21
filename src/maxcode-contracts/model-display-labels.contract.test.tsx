import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SessionIdentityChips } from "@/components/conversations/session-details-content"
import { TurnStats } from "@/components/message/turn-stats"
import { ModelLabelProvider } from "@/components/message/model-label-context"
import { MessageScrollProvider } from "@/components/message/message-scroll-context"
import { useModelLabels } from "@/hooks/use-model-labels"
import {
  getModelLabels,
  rememberModelLabels,
  subscribeModelLabels,
} from "@/lib/model-label-store"
import type { AgentType, SessionConfigOptionInfo } from "@/lib/types"
import en from "@/i18n/messages/en.json"
import { source } from "./contract-source"

vi.mock("@/components/message/use-new-chat-from-message", () => ({
  useNewChatFromMessage: () => () => {},
}))
afterEach(cleanup)

function options(id: string, name: string): SessionConfigOptionInfo[] {
  return [
    {
      id: "model",
      name: "Model",
      kind: {
        type: "select",
        current_value: id,
        options: [{ value: id, name }],
        groups: [],
      },
    },
  ]
}

function History({ agent, ids }: { agent: AgentType; ids: string[] }) {
  const label = useModelLabels(agent)
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <SessionIdentityChips agentType={agent} model={ids[0]} />
      <MessageScrollProvider value={{ scrollToIndex: vi.fn() }}>
        <ModelLabelProvider value={label}>
          <TurnStats copyText="Completed reply" model={ids[0]} models={ids} />
        </ModelLabelProvider>
      </MessageScrollProvider>
    </NextIntlClientProvider>
  )
}

describe("MaxCode model display labels", () => {
  it("updates visible history and chips without changing raw ids or other agents", async () => {
    const ids = ["contract-primary", "contract-unknown"]
    const config = options(ids[0], "Pi Workspace Model")
    const original = JSON.stringify(config)
    rememberModelLabels("codex", options(ids[0], "Codex Workspace Model"))
    const codexSnapshot = getModelLabels("codex")
    render(<History agent="pi" ids={ids} />)
    expect(screen.getByText(ids[0])).toBeInTheDocument()
    act(() => rememberModelLabels("pi", config))
    expect(screen.getByText("Pi Workspace Model")).toBeInTheDocument()
    await userEvent.hover(
      screen.getByLabelText(en.Folder.chat.messageList.model)
    )
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Pi Workspace Model, contract-unknown"
    )
    expect(ids).toEqual(["contract-primary", "contract-unknown"])
    expect(JSON.stringify(config)).toBe(original)
    expect(getModelLabels("codex")).toBe(codexSnapshot)
    expect(codexSnapshot.get(ids[0])).toBe("Codex Workspace Model")
    expect(
      JSON.parse(localStorage.getItem("codeg:model-labels")!).pi[ids[0]]
    ).toBe("Pi Workspace Model")
  })

  it("keeps absent history labels, but honors an explicit rename back to the id", () => {
    const first = options("contract-old", "Old friendly name")
    rememberModelLabels("deepseek", first)
    rememberModelLabels(
      "deepseek",
      options("contract-new", "New friendly name")
    )
    expect(getModelLabels("deepseek").get("contract-old")).toBe(
      "Old friendly name"
    )
    const listener = vi.fn()
    const unsubscribe = subscribeModelLabels(listener)
    try {
      rememberModelLabels("deepseek", options("contract-old", "contract-old"))
      expect(getModelLabels("deepseek").has("contract-old")).toBe(false)
      expect(getModelLabels("deepseek").get("contract-new")).toBe(
        "New friendly name"
      )
      expect(listener).toHaveBeenCalledTimes(1)
      rememberModelLabels("deepseek", options("contract-old", "contract-old"))
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it("captures live and replay selectors from the connection while keeping downstream cache helpers", () => {
    const context = source("src/contexts/acp-connections-context.tsx")
    expect(context).toContain(
      "rememberModelLabels(cfgConn.agentType, e.config_options)"
    )
    expect(context).toContain(
      "rememberModelLabels(rdyConn.agentType, rdyConn.configOptions)"
    )
    expect(context).toContain("updateCachedSelectors(cfgConn.agentType")
    expect(context).toContain("ensureCachedSelectors(rdyConn.agentType")
  })
})
