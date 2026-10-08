import { render, screen, waitFor, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import type { ComponentProps } from "react"
import type { Editor } from "@tiptap/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { RichComposerHandle } from "@/components/chat/composer/rich-composer"
import { serializeDocToText } from "@/components/chat/composer/to-prompt-blocks"
import {
  clearMessageInputDraftV2,
  saveMessageInputDraftV2,
} from "@/lib/message-input-draft"

// MessageInput holds its RichComposer handle internally and does not forward a
// ref, so capture that handle through a partial mock that still renders the real
// composer. The "insertion position" tests below drive the very Tiptap editor
// the attach-to-chat event writes into — setting its content + caret — then
// assert where the badge lands.
const composerHandle = vi.hoisted(() => ({
  current: null as RichComposerHandle | null,
}))
vi.mock("@/components/chat/composer/rich-composer", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/chat/composer/rich-composer")
    >()
  const React = await import("react")
  const Captured = React.forwardRef<
    RichComposerHandle,
    ComponentProps<typeof actual.RichComposer>
  >((props, ref) => {
    const assign = (handle: RichComposerHandle | null) => {
      composerHandle.current = handle
      if (typeof ref === "function") ref(handle)
      else if (ref) ref.current = handle
    }
    return React.createElement(actual.RichComposer, { ...props, ref: assign })
  })
  Captured.displayName = "CapturedRichComposer"
  return { ...actual, RichComposer: Captured }
})

// Mock the data hooks / platform so MessageInput mounts without hitting the
// backend. The reference-search provider and slash sources are all empty: this
// is a wiring smoke test (does the RichComposer-based input mount and reflect
// empty/send state), not a data test.
vi.mock("@/hooks/use-shortcut-settings", () => ({
  useShortcutSettings: () => ({
    shortcuts: { send_message: "enter", newline_in_message: "shift+enter" },
  }),
}))
// A vi.fn (not a bare arrow) so the `$` autocomplete tests can land the disk
// scan mid-test; defaults to "no skills" for every other test in this file.
const agentSkills = vi.hoisted(() => vi.fn(() => [] as unknown[]))
vi.mock("@/hooks/use-agent-skills", () => ({ useAgentSkills: agentSkills }))
vi.mock("@/hooks/use-built-in-experts", () => ({ useBuiltInExperts: () => [] }))
vi.mock("@/hooks/use-built-in-science", () => ({ useBuiltInScience: () => [] }))
vi.mock("@/hooks/use-enabled-skill-ids", () => ({
  useEnabledSkillIds: () => ({
    enabledIds: new Set(),
    ready: false,
    supported: true,
  }),
}))
vi.mock("@/components/chat/composer/use-reference-search", () => ({
  useReferenceSearch: () => async () => [],
}))
vi.mock("@/components/chat/conversation-context-bar", () => ({
  ConversationContextBar: ({
    extraContent,
  }: {
    extraContent?: React.ReactNode
  }) => <div data-testid="ctx-bar">{extraContent}</div>,
  // The composer imports these to render the below-input folder/branch row.
  // Keep it hidden here (visibility → false) so these tests exercise the bare
  // composer without pulling in the picker's tab-store/git dependencies.
  ConversationFolderBranchPicker: () => null,
  useConversationFolderBranchPickerVisible: () => false,
}))
vi.mock("@/lib/platform", () => ({
  isDesktop: () => false,
  openFileDialog: vi.fn(),
}))
vi.mock("@/lib/transport", () => ({
  getActiveRemoteConnectionId: () => null,
}))
// Real classifier only recognizes actual backend NoActiveTurn payloads; the
// steering tests flip this per-case to drive the enqueue fallback.
vi.mock("@/lib/turn-busy", () => ({
  isNoActiveTurnRejection: vi.fn(() => false),
}))
// Nothing here mounts a Toaster, so toasts would vanish silently — record them
// instead. The steering tests assert the uploading gate's honest signal.
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}))
// Wrap-mock (rich-composer pattern above): render the REAL attachments hook,
// but let a test stage image attachments — the drop/paste pipelines that
// normally populate them need real files and upload endpoints.
type ComposerAttachmentsApi = ReturnType<
  typeof import("@/components/chat/composer/use-composer-attachments").useComposerAttachments
>
const attachmentsOverride = vi.hoisted(() => ({
  current: null as Partial<ComposerAttachmentsApi> | null,
}))
vi.mock(
  "@/components/chat/composer/use-composer-attachments",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/chat/composer/use-composer-attachments")
      >()
    return {
      ...actual,
      useComposerAttachments: (
        ...args: Parameters<typeof actual.useComposerAttachments>
      ) => {
        const real = actual.useComposerAttachments(...args)
        const override = attachmentsOverride.current
        return override ? { ...real, ...override } : real
      },
    }
  }
)
// virtua renders 0 rows under jsdom — render children directly so the large
// (searchable + virtualized) model list is exercisable here too.
vi.mock("virtua", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    Virtualizer: forwardRef(function VirtualizerMock(
      props: { children?: React.ReactNode },
      ref: React.Ref<{ scrollToIndex: () => void }>
    ) {
      useImperativeHandle(ref, () => ({ scrollToIndex: () => {} }))
      return <>{props.children}</>
    }),
  }
})

// ModelOptionList mounts virtua only after the OverlayScrollbars viewport is
// surfaced via `onViewportRef`; jsdom never initializes OS, so drive it here.
vi.mock("@/components/ui/scroll-area", async () => {
  const { useEffect } = await import("react")
  return {
    ScrollArea: ({
      children,
      onViewportRef,
    }: {
      children?: React.ReactNode
      onViewportRef?: (el: HTMLElement | null) => void
    }) => {
      useEffect(() => {
        onViewportRef?.(document.createElement("div"))
      }, [onViewportRef])
      return <>{children}</>
    },
  }
})

// ModelOptionList sizes its scroll window in rem, so it reads the live zoom
// level — which throws outside an AppearanceProvider, and this suite renders the
// composer bare. Pin it at 100% (1rem = 16px). Spread the real module so the
// other appearance hooks keep their real (provider-requiring) behaviour instead
// of silently resolving to `undefined` if something here starts using one.
vi.mock("@/hooks/use-appearance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-appearance")>()),
  useZoomLevel: () => ({ zoomLevel: 100, setZoomLevel: () => {} }),
}))

import enMessages from "@/i18n/messages/en.json"
import type { PromptCapabilitiesInfo } from "@/lib/types"

import { MessageInput } from "@/components/chat/message-input"

const CAPS: PromptCapabilitiesInfo = {
  image: true,
  audio: false,
  embedded_context: true,
}

function renderInput(
  props: Partial<React.ComponentProps<typeof MessageInput>>
) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MessageInput onSend={vi.fn()} promptCapabilities={CAPS} {...props} />
    </NextIntlClientProvider>
  )
}

describe("tab-activation auto-focus", () => {
  afterEach(() => cleanup())
  const draftKey = "test:tab-activation-focus"
  // The browser's answer to the primary-pointer query. Every other query
  // keeps the setup's desktop answer. `setPointer` changes it mid-session the
  // way docking a 2-in-1 does, telling whoever listens.
  let pointerCoarse = false
  const pointerListeners = new Set<() => void>()
  function setPointer(coarse: boolean) {
    pointerCoarse = coarse
    pointerListeners.forEach((listener) => listener())
  }
  beforeEach(() => {
    const desktop = window.matchMedia
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      query === "(pointer: coarse)"
        ? ({
            media: query,
            get matches() {
              return pointerCoarse
            },
            addEventListener: (_type: string, listener: () => void) =>
              pointerListeners.add(listener),
            removeEventListener: (_type: string, listener: () => void) =>
              pointerListeners.delete(listener),
          } as unknown as MediaQueryList)
        : desktop(query)
    )
  })
  afterEach(() => {
    vi.mocked(window.matchMedia).mockRestore()
    pointerListeners.clear()
    pointerCoarse = false
    clearMessageInputDraftV2(draftKey)
  })

  const composer = (isActive: boolean) => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MessageInput
        onSend={vi.fn()}
        promptCapabilities={CAPS}
        draftStorageKey={draftKey}
        isActive={isActive}
      />
    </NextIntlClientProvider>
  )
  const nextFrame = () =>
    act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
  async function mountReady(isActive: boolean, coarse: boolean) {
    setPointer(coarse)
    saveMessageInputDraftV2(draftKey, {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "draft" }] },
      ],
    })
    const view = render(composer(isActive))
    await waitFor(
      () =>
        expect(
          view.container.querySelector('[role="textbox"]')?.textContent
        ).toBe("draft"),
      { timeout: 5000 }
    )
    return view
  }

  describe.each([
    ["coarse", "leaves the composer unfocused", true, false],
    ["fine", "focuses the composer", false, true],
  ] as const)(
    "on a %s pointer, tab activation %s",
    (_pointer, _outcome, coarse, focused) => {
      it("when the session opens in an active tab", async () => {
        const { container } = await mountReady(true, coarse)
        await nextFrame() // Tiptap's deferred DOM focus
        const editor = container.querySelector('[role="textbox"]')
        expect(document.activeElement).toBe(focused ? editor : document.body)
      })

      it("when switching to a session already open in the background", async () => {
        const { container, rerender } = await mountReady(false, coarse)
        // Still in the background, the composer holds no focus, so whatever
        // the assertion below sees is the switch's doing.
        await nextFrame() // Tiptap's deferred DOM focus, were one scheduled
        expect(document.activeElement).toBe(document.body)

        rerender(composer(true))
        await nextFrame() // the auto-focus effect's own frame
        await nextFrame() // Tiptap's deferred DOM focus
        const editor = container.querySelector('[role="textbox"]')
        expect(document.activeElement).toBe(focused ? editor : document.body)
      })
    }
  )

  // Passing through a tab, activating it and moving on before a frame is
  // drawn, must not leave the caret in a composer that is no longer active.
  // In a tiled group that composer is still on screen.
  it("drops the pending focus when the tab goes inactive before its frame", async () => {
    const { rerender } = await mountReady(false, false)
    rerender(composer(true))
    rerender(composer(false))
    await nextFrame() // the auto-focus effect's own frame
    await nextFrame() // Tiptap's deferred DOM focus
    expect(document.activeElement).toBe(document.body)
  })

  // A pointer change is not a reason to focus. The session stays as it was,
  // with no caret and no keyboard, until the user taps the composer.
  it("leaves focus alone when the pointer turns fine mid-session", async () => {
    await mountReady(true, true)
    await nextFrame() // Tiptap's deferred DOM focus, were one scheduled
    expect(document.activeElement).toBe(document.body)

    act(() => setPointer(false))
    await nextFrame() // an auto-focus effect's own frame, were one scheduled
    await nextFrame() // Tiptap's deferred DOM focus
    expect(document.activeElement).toBe(document.body)
  })
})

describe("MaxCode pending steering draft preservation", () => {
  afterEach(() => {
    cleanup()
    composerHandle.current = null
    attachmentsOverride.current = null
    vi.clearAllMocks()
  })

  const MI = enMessages.Folder.chat.messageInput

  async function mountPrompting(
    props: Partial<React.ComponentProps<typeof MessageInput>> = {}
  ) {
    renderInput({
      isPrompting: true,
      disabled: true,
      onCancel: vi.fn(),
      onEnqueue: vi.fn(),
      // The prop defaults to the weaker `pull` promise, so the native cases
      // below have to say so explicitly; the pull case overrides it back.
      steerChannel: "native",
      ...props,
    })
    await waitFor(
      () => expect(composerHandle.current?.getEditor()).toBeTruthy(),
      { timeout: 5000 }
    )
    const editor = composerHandle.current?.getEditor()
    if (!editor) throw new Error("composer editor not mounted")
    return editor
  }

  function typeDraft(editor: Editor, text: string) {
    // insertContent dispatches a real transaction, so the composer's
    // empty-tracking flips (plain setContent doesn't emit an update).
    act(() => {
      editor.commands.insertContent(text)
    })
  }

  it.each([
    ["native", false],
    ["pull", false],
    ["native", true],
    ["pull", true],
  ] as const)(
    "preserves edits during a %s steer (turn ended: %s)",
    async (steerChannel, turnEnded) => {
      const user = userEvent.setup()
      const { isNoActiveTurnRejection } = await import("@/lib/turn-busy")
      vi.mocked(isNoActiveTurnRejection).mockReturnValue(turnEnded)
      let finish: () => void = () => {}
      const onSteer = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = () =>
              turnEnded ? reject(new Error("no active turn")) : resolve()
          })
      )
      const onEnqueue = vi.fn()
      const editor = await mountPrompting({
        onSteer,
        onEnqueue,
        steerChannel,
      })
      typeDraft(editor, "original instruction")
      const label =
        steerChannel === "native" ? MI.steerIntoTurn : MI.steerAsNote
      await user.click(screen.getByLabelText(label))
      await user.click(await screen.findByRole("menuitem", { name: label }))
      typeDraft(editor, " additional instruction")
      await act(async () => finish())
      expect(serializeDocToText(editor.state.doc)).toContain(
        "additional instruction"
      )
      if (turnEnded) {
        expect(onEnqueue).toHaveBeenCalledWith(
          expect.objectContaining({ displayText: "original instruction" }),
          null
        )
      }
    }
  )
})

describe("MaxCode attachments edited during steering", () => {
  afterEach(() => {
    cleanup()
    attachmentsOverride.current = null
    composerHandle.current = null
    vi.clearAllMocks()
  })
  it.each([false, true])(
    "keeps a newly added image when delivery settles (turn ended: %s)",
    async (turnEnded) => {
      const user = userEvent.setup()
      const { isNoActiveTurnRejection } = await import("@/lib/turn-busy")
      vi.mocked(isNoActiveTurnRejection).mockReturnValue(turnEnded)
      let finish: () => void = () => {}
      const onSteer = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            finish = () =>
              turnEnded ? reject(new Error("no active turn")) : resolve()
          })
      )
      const onEnqueue = vi.fn()
      const clearAttachments = vi.fn()
      attachmentsOverride.current = { clearAttachments }
      const props = {
        isPrompting: true,
        disabled: true,
        onCancel: vi.fn(),
        onSteer,
        onEnqueue,
        steerChannel: "native" as const,
      }
      const view = renderInput(props)
      await waitFor(() =>
        expect(composerHandle.current?.getEditor()).toBeTruthy()
      )
      const editor = composerHandle.current!.getEditor()!
      act(() => {
        editor.commands.insertContent("original instruction")
      })
      const label = enMessages.Folder.chat.messageInput.steerIntoTurn
      await user.click(screen.getByLabelText(label))
      await user.click(await screen.findByRole("menuitem", { name: label }))
      const image = {
        type: "image" as const,
        data: "aGk=",
        mime_type: "image/png",
      }
      attachmentsOverride.current = {
        clearAttachments,
        imagePromptBlocks: () => [image],
      }
      view.rerender(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <MessageInput onSend={vi.fn()} promptCapabilities={CAPS} {...props} />
        </NextIntlClientProvider>
      )
      await act(async () => finish())
      expect(clearAttachments).not.toHaveBeenCalled()
      expect(serializeDocToText(editor.state.doc)).toBe("original instruction")
      expect(onSteer).toHaveBeenCalledTimes(1)
      expect(onSteer.mock.calls[0]).toEqual(["original instruction", undefined])
      if (turnEnded)
        expect(onEnqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            blocks: [{ type: "text", text: "original instruction" }],
          }),
          null
        )
    }
  )
})
