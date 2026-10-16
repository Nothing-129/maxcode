import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import en from "@/i18n/messages/en.json"
import { TodoTeamsDialog } from "@/components/todos/todo-teams-dialog"
import type { TodoState } from "@/lib/todos"

const mutate = vi.fn()
const storage = vi.fn(async (scopeId: string) => {
  void scopeId
  return null
})
let state: TodoState
vi.mock("@/contexts/todos-view-context", () => ({
  useTodosView: () => ({ state, mutate, busy: false, loading: false }),
}))
vi.mock("@/lib/todo-storage", () => ({
  todoStorageConfig: (scopeId: string) => storage(scopeId),
  emptyMinioConfig: () => ({
    endpoint: "",
    bucket: "",
    public_url: "",
    access_key: "",
    secret_key: "",
    region: "us-east-1",
  }),
}))
function open() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TodoTeamsDialog onClose={vi.fn()} />
    </NextIntlClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  state = {
    mode: "team",
    active_team_id: "engineering",
    self_id: "alex",
    teams: [
      { id: "engineering", name: "Engineering", is_local: true, url: null },
      {
        id: "design",
        name: "Design",
        is_local: false,
        url: "https://team.example",
      },
    ],
    members: [
      { id: "alex", name: "Alex", avatar: "data:image/png;base64,AA" },
      { id: "sam", name: "Sam", avatar: "data:image/png;base64,BB" },
    ],
    todos: [],
    team_code: "maxcode-team:private-invitation",
    public_url: "https://team.example",
  }
})
describe("MaxCode team management", () => {
  it("opens on the member roster, marks self and hides creation and storage forms", () => {
    open()
    const members = screen.getByRole("list", { name: "Team members" })
    expect(within(members).getAllByRole("listitem")).toHaveLength(2)
    expect(within(members).getByText("Alex")).toBeInTheDocument()
    expect(within(members).getByText("Sam")).toBeInTheDocument()
    expect(within(members).getByText("You")).toBeInTheDocument()
    expect(screen.queryByLabelText(en.Todos.teamName)).not.toBeInTheDocument()
    expect(screen.queryByText(state.team_code!)).not.toBeInTheDocument()
    expect(storage).not.toHaveBeenCalled()
  })
  it("copies the invitation without showing its raw contents", async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole("button", { name: "Copy invitation" }))
    expect(await navigator.clipboard.readText()).toBe(state.team_code)
  })
  it("separates create and join forms and defers storage until team settings", async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole("button", { name: en.Todos.createTeam }))
    expect(screen.getByLabelText(en.Todos.teamName)).toBeInTheDocument()
    expect(screen.getByLabelText(en.Todos.memberName)).toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
    expect(
      screen.queryByLabelText(en.Todos.minio_endpoint)
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Back to teams" }))
    await user.click(screen.getByRole("button", { name: en.Todos.joinTeam }))
    expect(screen.getByLabelText(en.Todos.teamCode)).toBeInTheDocument()
    expect(screen.queryByLabelText(en.Todos.teamName)).not.toBeInTheDocument()
  })
  it("switches team through the scoped state mutation", async () => {
    const user = userEvent.setup()
    open()
    await user.selectOptions(screen.getByRole("combobox"), "design")
    expect(mutate).toHaveBeenCalledWith({
      action: "set_mode",
      mode: "team",
      team_id: "design",
    })
  })
  it("shows the selected team's roster and hides host settings for remote members", () => {
    state = {
      ...state,
      active_team_id: "design",
      self_id: "lee",
      members: [{ id: "lee", name: "Lee", avatar: "" }],
      team_code: null,
    }
    open()
    expect(screen.getByText("Lee")).toBeInTheDocument()
    expect(screen.queryByText("Alex")).not.toBeInTheDocument()
    expect(screen.queryByText("Team settings")).not.toBeInTheDocument()
  })
  it("labels disconnected rosters and handles unavailable member data", () => {
    state = { ...state, members: [], connection_error: "offline" }
    open()
    expect(screen.getByText(en.Todos.membersOfflineHint)).toBeInTheDocument()
    expect(screen.getByText(en.Todos.membersUnavailable)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Copy invitation" })
    ).toBeDisabled()
  })
  it("does not show personal profiles as team members", () => {
    state = { ...state, mode: "personal", active_team_id: null }
    open()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
    expect(screen.queryByText("Alex")).not.toBeInTheDocument()
  })
})

describe("MaxCode team removal", () => {
  it("requires the hosted team name before dissolution and allows cancel", async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole("button", { name: "Dissolve team" }))
    const dialog = screen.getByRole("alertdialog")
    const confirm = within(dialog).getByRole("button", {
      name: "Dissolve team",
    })
    expect(confirm).toBeDisabled()
    await user.type(
      within(dialog).getByLabelText("Enter the team name to confirm"),
      "Wrong"
    )
    expect(confirm).toBeDisabled()
    await user.clear(
      within(dialog).getByLabelText("Enter the team name to confirm")
    )
    await user.type(
      within(dialog).getByLabelText("Enter the team name to confirm"),
      "Engineering"
    )
    expect(confirm).toBeEnabled()
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })
  it("pins dissolution to the confirmed team and retains errors for retry", async () => {
    const user = userEvent.setup()
    mutate.mockRejectedValueOnce(new Error("Deletion failed"))
    open()
    await user.click(screen.getByRole("button", { name: "Dissolve team" }))
    const dialog = screen.getByRole("alertdialog")
    await user.type(
      within(dialog).getByLabelText("Enter the team name to confirm"),
      "Engineering"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Dissolve team" })
    )
    expect(mutate).toHaveBeenCalledWith({
      action: "dissolve_team",
      team_id: "engineering",
      name: "Engineering",
    })
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Deletion failed"
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Dissolve team" })
    )
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })
  it("offers local removal for a disconnected joined team without requiring its name", async () => {
    const user = userEvent.setup()
    state = { ...state, active_team_id: "design", connection_error: "offline" }
    open()
    await user.click(
      screen.getByRole("button", { name: "Remove from this device" })
    )
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument()
    expect(
      within(dialog).getByText(/membership on its host remain unchanged/)
    ).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole("button", { name: "Remove from this device" })
    )
    expect(mutate).toHaveBeenCalledWith({
      action: "remove_team",
      team_id: "design",
    })
  })
})
