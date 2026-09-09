/**
 * Always-on selected chrome for the conversation composer.
 *
 * Both conversation locations render this through `<ChatInput>` →
 * `<MessageInput>`:
 *   1. the new-conversation (welcome) input in the empty-state column
 *   2. the same input after the first send, docked at the bottom of the thread
 *
 * The box already looks ready to type. Do not add a click-only
 * `focus-within` ring — that is the style this module replaces.
 */
export const COMPOSER_CHROME_BOX_CLASS =
  "codeg-composer-chrome relative rounded-[1.25rem] border border-black/[0.06] dark:border-white/[0.08]"

/** Soft composer elevation; the supplied desktop reference uses a subtle
 * outline and a diffuse shadow rather than a prominent raised card. */
export const COMPOSER_CHROME_SHADOW_CLASS =
  "maxcode-composer-shadow shadow-[0_2px_8px_rgba(0,0,0,0.025),0_4px_32px_rgba(0,0,0,0.015)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.1)]"

/** Opaque surface that still goes transparent over a workspace background. */
export const COMPOSER_CHROME_SURFACE_CLASS = "bg-background ws-transparent-bg"
