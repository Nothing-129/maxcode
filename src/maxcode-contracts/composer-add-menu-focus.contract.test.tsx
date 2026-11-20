import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { createRef } from "react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ComposerAddMenu } from "@/components/chat/composer/composer-add-menu"
import {
  RichComposer,
  type RichComposerHandle,
} from "@/components/chat/composer/rich-composer"
import { useComposerShortcuts } from "@/components/chat/composer/use-composer-shortcuts"
import messages from "@/i18n/messages/en.json"

vi.mock("@/lib/api", () => ({
  quickMessagesList: vi.fn(async () => [
    { id: "quick", title: "Greeting", content: "hello" },
  ]),
  openSettingsWindow: vi.fn(),
}))
vi.mock("@/hooks/use-built-in-experts", () => ({ useBuiltInExperts: () => [] }))
vi.mock("@/hooks/use-built-in-science", () => ({ useBuiltInScience: () => [] }))
vi.mock("@/hooks/use-enabled-skill-ids", () => ({
  useEnabledSkillIds: () => ({
    enabledIds: new Set(),
    ready: true,
    supported: true,
  }),
}))

afterEach(cleanup)
const labels = messages.Folder.chat.messageInput

async function mount() {
  const ref = createRef<RichComposerHandle>()
  function Harness() {
    const shortcuts = useComposerShortcuts({
      editorRef: ref,
      agentType: "codex",
    })
    return (
      <>
        <RichComposer ref={ref} defaultText="before after" />
        <ComposerAddMenu
          attachments={{
            handleUploadLocalFiles: async () => {},
            setServerFilePickerOpen: () => {},
          }}
          shortcuts={shortcuts}
          slashCommands={[{ name: "goal", description: "Set a goal" }]}
          collaboration={{
            key: "collaboration",
            title: labels.composerConfig.collaboration,
            currentValue: "default",
            currentLabel: "Default",
            groups: [
              {
                key: "modes",
                name: null,
                options: [{ value: "default", name: "Default" }],
              },
            ],
            onSelect: () => {},
          }}
        />
      </>
    )
  }
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Harness />
    </NextIntlClientProvider>
  )
  await waitFor(() => expect(ref.current?.getEditor()).toBeTruthy())
  const editor = ref.current!.getEditor()!
  act(() => editor.commands.setTextSelection(8))
  const trigger = screen.getByRole("button", { name: labels.addActions })
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" })
  })
  return { ref, editor, trigger }
}

async function openSubmenu(label: string) {
  const item = screen.getByRole("menuitem", { name: label })
  act(() => item.focus())
  fireEvent.keyDown(item, { key: "ArrowRight" })
}

describe("MaxCode: composer add menu appearance", () => {
  it("uses text for attachments and only trailing arrows for submenus", async () => {
    await mount()
    const menu = screen.getByRole("menu")
    expect(menu).toHaveClass("min-w-48", "text-left")
    for (const name of [labels.attachLocalUpload, labels.attachServerFile]) {
      expect(screen.getByRole("menuitem", { name }).childElementCount).toBe(0)
    }
    for (const name of [
      labels.quickMessages,
      labels.slashCommands,
      labels.composerConfig.collaboration,
    ]) {
      const trigger = screen.getByRole("menuitem", { name })
      expect(trigger.childElementCount).toBe(1)
      expect(trigger.lastElementChild).toHaveClass("lucide-chevron-right")
    }
  })

  it.each([
    [labels.quickMessages, "menuitem", "Greeting"],
    [labels.slashCommands, "menuitem", /goal/],
    [labels.composerConfig.collaboration, "menuitemradio", "Default"],
  ])("styles the scrollable list in %s", async (label, role, name) => {
    await mount()
    await openSubmenu(label)
    const item = await screen.findByRole(role, { name })
    expect(item.closest(".overflow-y-auto")).toHaveClass("submenu-scrollbar")
  })
})

describe("MaxCode: add-menu insertions return the caret to the composer", () => {
  it.each(["click", "keyboard", "search-enter"])(
    "continues typing after a command selected via %s",
    async (method) => {
      const { ref, editor } = await mount()
      await openSubmenu(labels.slashCommands)
      if (method === "search-enter") {
        const search = screen.getByRole("searchbox")
        fireEvent.change(search, { target: { value: "goal" } })
        fireEvent.keyDown(search, { key: "Enter" })
      } else {
        const item = screen.getByRole("menuitem", { name: /goal/ })
        if (method === "click") fireEvent.click(item)
        else {
          act(() => item.focus())
          fireEvent.keyDown(item, { key: "Enter" })
        }
      }
      await waitFor(() => {
        expect(screen.queryByRole("menu")).toBeNull()
        expect(document.activeElement).toBe(editor.view.dom)
      })
      const caret = editor.state.selection.from
      expect(editor.state.doc.textBetween(caret - 1, caret)).toBe(" ")
      act(() => editor.commands.insertContent("details"))
      expect(ref.current!.getText()).toBe("before /goal detailsafter")
    }
  )

  it("restores the caret after a quick message", async () => {
    const { ref, editor } = await mount()
    await openSubmenu(labels.quickMessages)
    fireEvent.click(await screen.findByRole("menuitem", { name: "Greeting" }))
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom))
    act(() => editor.commands.insertContent("!"))
    expect(ref.current!.getText()).toBe("before hello!after")
  })

  it("returns focus to the add button when dismissed without inserting", async () => {
    const { trigger } = await mount()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
