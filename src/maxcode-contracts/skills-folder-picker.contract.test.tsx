import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { expect, it, vi } from "vitest"
import { SkillsSettings } from "@/components/settings/skills-settings"
import messages from "@/i18n/messages/en.json"
import { acpListAgentSkills } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  acpListAgents: async () => [{ agent_type: "codex", name: "Codex" }],
  acpListAgentSkills: vi.fn(async () => ({
    supported: true,
    skills: [],
    locations: [],
  })),
  loadFolderHistory: async () => [
    { id: 2, name: "repo", path: "/one/repo" },
    { id: 3, name: "repo", path: "/two/repo" },
  ],
}))

it("searches registered projects and loads skills from the chosen path", async () => {
  const user = userEvent.setup()
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SkillsSettings />
    </NextIntlClientProvider>
  )
  await user.click(
    await screen.findByRole("button", {
      name: messages.SkillsSettings.scope.folder,
    })
  )
  await user.click(
    screen.getByRole("button", {
      name: messages.SkillsSettings.scope.selectFolderPlaceholder,
    })
  )
  const search = screen.getByPlaceholderText(
    messages.Folder.conversationContextBar.searchFolder
  )
  await user.type(search, "/two/repo")
  await user.click(screen.getByText("/two/repo"))
  await waitFor(() =>
    expect(acpListAgentSkills).toHaveBeenCalledWith({
      agentType: "codex",
      workspacePath: "/two/repo",
    })
  )
})
