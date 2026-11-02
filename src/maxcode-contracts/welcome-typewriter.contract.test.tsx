import { cleanup, render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, expect, it } from "vitest"
import { WelcomeHero } from "@/components/chat/welcome-hero"
import zh from "@/i18n/messages/zh-CN.json"
import { source } from "./contract-source"

afterEach(cleanup)
const view = (messages = zh) => (
  <NextIntlClientProvider locale="zh-CN" messages={messages}>
    <WelcomeHero />
  </NextIntlClientProvider>
)
it("preserves the full accessible heading and stable character nodes on rerender", () => {
  const result = render(view())
  const heading = screen.getByRole("heading", { name: "今天准备做些什么呢？" })
  expect(heading.textContent).toBe("今天准备做些什么呢？")
  const characters = heading.querySelectorAll(".maxcode-welcome-character")
  expect(characters).toHaveLength(10)
  expect(characters[0].parentElement).toHaveAttribute("aria-hidden", "true")
  expect(
    (characters[0] as HTMLElement).style.getPropertyValue("--character-delay")
  ).toBe("40ms")
  expect(
    (characters[9] as HTMLElement).style.getPropertyValue("--character-delay")
  ).toBe("445ms")
  result.rerender(view())
  expect(heading.querySelector(".maxcode-welcome-character")).toBe(
    characters[0]
  )
})
it("does not split emoji or combining characters", () => {
  const messages = structuredClone(zh)
  messages.Folder.chat.welcomePanel.greeting = "👨‍👩‍👧‍👦<highlight>é</highlight>？"
  const result = render(view(messages))
  expect(
    [...result.container.querySelectorAll(".maxcode-welcome-character")].map(
      (e) => e.textContent
    )
  ).toEqual(["👨‍👩‍👧‍👦", "é", "？"])
})
it("reveals once without changing layout and honors reduced motion", () => {
  const css = source("src/app/motion.css")
  const rules = css.slice(css.indexOf("/* Reserve the complete greeting"))
  expect(rules).toContain("step-end var(--character-delay) both")
  expect(rules).not.toMatch(/infinite|width:|transform:|display: none/)
  expect(rules).toContain("prefers-reduced-motion: reduce")
  expect(rules).toContain("animation: none")
})
