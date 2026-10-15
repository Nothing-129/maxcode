import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", () => ({
  getFeedbackSettings: vi.fn(),
  setFeedbackSettings: vi.fn(),
  getQuestionSettings: vi.fn(),
  setQuestionSettings: vi.fn(),
  getSessionInfoSettings: vi.fn(),
  setSessionInfoSettings: vi.fn(),
  getChatAuthoringSettings: vi.fn(),
  setChatAuthoringSettings: vi.fn(),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Avoid mutating the shared module cache across tests.
vi.mock("@/hooks/use-feedback-enabled", () => ({
  primeFeedbackEnabled: vi.fn(),
}))

import { AgentToolsSettingsSection } from "./agent-tools-settings"
import enMessages from "@/i18n/messages/en.json"
import {
  getChatAuthoringSettings,
  getFeedbackSettings,
  getQuestionSettings,
  getSessionInfoSettings,
  setChatAuthoringSettings,
  setFeedbackSettings,
  setQuestionSettings,
  setSessionInfoSettings,
} from "@/lib/api"
import { primeFeedbackEnabled } from "@/hooks/use-feedback-enabled"

const mockGetFeedback = vi.mocked(getFeedbackSettings)
const mockSetFeedback = vi.mocked(setFeedbackSettings)
const mockGetQuestion = vi.mocked(getQuestionSettings)
const mockSetQuestion = vi.mocked(setQuestionSettings)
const mockGetSessionInfo = vi.mocked(getSessionInfoSettings)
const mockSetSessionInfo = vi.mocked(setSessionInfoSettings)
const mockGetChat = vi.mocked(getChatAuthoringSettings)
const mockSetChat = vi.mocked(setChatAuthoringSettings)
const mockPrime = vi.mocked(primeFeedbackEnabled)

const LABELS = {
  feedback: "Live Feedback",
  question: "Ask user question",
  sessionInfo: "Get session info",
  automations: "Create automations",
  workTasks: "Create to-do tasks",
} as const

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AgentToolsSettingsSection />
    </NextIntlClientProvider>
  )
}

/** Every endpoint resolves; each `set*` echoes what it was handed. */
function primeBackend(
  overrides: {
    feedback?: boolean
    question?: boolean
    sessionInfo?: boolean
    automations?: boolean
    workTasks?: boolean
  } = {}
) {
  const {
    feedback = false,
    question = true,
    sessionInfo = true,
    automations = false,
    workTasks = false,
  } = overrides
  mockGetFeedback.mockResolvedValue({ enabled: feedback })
  mockGetQuestion.mockResolvedValue({ enabled: question })
  mockGetSessionInfo.mockResolvedValue({ enabled: sessionInfo })
  mockGetChat.mockResolvedValue({
    automations_enabled: automations,
    work_tasks_enabled: workTasks,
  })
  mockSetFeedback.mockImplementation(async (next) => next)
  mockSetQuestion.mockImplementation(async (next) => next)
  mockSetSessionInfo.mockImplementation(async (next) => next)
  mockSetChat.mockImplementation(async (next) => next)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AgentToolsSettingsSection", () => {
  it("shows the four supported tool switches without exposing the historical task writer", async () => {
    primeBackend({ feedback: true, sessionInfo: false, workTasks: true })

    renderWithIntl()

    expect(await screen.findByLabelText(LABELS.feedback)).toHaveAttribute(
      "data-state",
      "checked"
    )
    expect(screen.getByLabelText(LABELS.question)).toHaveAttribute(
      "data-state",
      "checked"
    )
    expect(screen.getByLabelText(LABELS.sessionInfo)).toHaveAttribute(
      "data-state",
      "unchecked"
    )
    expect(screen.getByLabelText(LABELS.automations)).toHaveAttribute(
      "data-state",
      "unchecked"
    )
    expect(screen.getAllByRole("switch")).toHaveLength(4)
    expect(screen.queryByLabelText(LABELS.workTasks)).not.toBeInTheDocument()
    expect(screen.queryByText(LABELS.workTasks)).not.toBeInTheDocument()
  })

  it("saves only the group the user changed", async () => {
    primeBackend()

    renderWithIntl()

    fireEvent.click(await screen.findByLabelText(LABELS.question))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(mockSetQuestion).toHaveBeenCalledWith({ enabled: false })
    })
    // The other three endpoints hold values this panel never touched; writing
    // them back would republish state the user didn't ask to change.
    expect(mockSetFeedback).not.toHaveBeenCalled()
    expect(mockSetSessionInfo).not.toHaveBeenCalled()
    expect(mockSetChat).not.toHaveBeenCalled()
  })

  it("preserves the loaded historical task flag when saving automation changes and primes the feedback cache", async () => {
    primeBackend({ workTasks: true })

    renderWithIntl()

    fireEvent.click(await screen.findByLabelText(LABELS.feedback))
    fireEvent.click(screen.getByLabelText(LABELS.automations))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(mockSetChat).toHaveBeenCalledWith({
        automations_enabled: true,
        work_tasks_enabled: true,
      })
    })
    expect(mockSetFeedback).toHaveBeenCalledWith({ enabled: true })
    // Open conversations show/hide the feedback bar off this cached flag.
    expect(mockPrime).toHaveBeenCalledWith(true)
  })

  it("keeps Save inert until something actually changes", async () => {
    primeBackend()

    renderWithIntl()

    const save = await screen.findByRole("button", { name: "Save" })
    expect(save).toBeDisabled()

    fireEvent.click(screen.getByLabelText(LABELS.sessionInfo))
    expect(save).toBeEnabled()
  })

  it("reports a failed group without blanking the rest, and won't write it back", async () => {
    primeBackend({ feedback: true })
    mockGetQuestion.mockRejectedValue(new Error("boom"))

    renderWithIntl()

    expect(await screen.findByRole("alert")).toHaveTextContent("boom")
    // Loaded groups still show what is stored…
    expect(screen.getByLabelText(LABELS.feedback)).toHaveAttribute(
      "data-state",
      "checked"
    )

    fireEvent.click(screen.getByLabelText(LABELS.sessionInfo))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(mockSetSessionInfo).toHaveBeenCalledWith({ enabled: false })
    })
    // …and the group whose load failed is showing a default, not stored state,
    // so an untouched switch must not overwrite the backend with it.
    expect(mockSetQuestion).not.toHaveBeenCalled()
  })
})
