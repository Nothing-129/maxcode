import { describe, expect, it } from "vitest"

import {
  formatConversationTitle,
  parseStructuredConversationTitle,
} from "./conversation-title"

describe("formatConversationTitle", () => {
  it("returns an empty string for nullish titles", () => {
    expect(formatConversationTitle(null)).toBe("")
    expect(formatConversationTitle(undefined)).toBe("")
    expect(formatConversationTitle("")).toBe("")
  })

  it("leaves plain prose untouched", () => {
    expect(formatConversationTitle("Fix the login bug")).toBe(
      "Fix the login bug"
    )
    expect(formatConversationTitle("看看这个问题")).toBe("看看这个问题")
  })

  it("reduces a file reference link to its label", () => {
    expect(
      formatConversationTitle("[README.md](file:///Users/x/README.md)")
    ).toBe("README.md")
  })

  it("keeps surrounding text around a reference link", () => {
    expect(
      formatConversationTitle(
        "看看 [README.md](file:///Users/x/README.md) 这是什么"
      )
    ).toBe("看看 README.md 这是什么")
  })

  it("folds multiple reference links in one title", () => {
    expect(
      formatConversationTitle(
        "compare [a.ts](file:///a.ts) and [b.ts](file:///b.ts)"
      )
    ).toBe("compare a.ts and b.ts")
  })

  it("reduces session/commit/agent links (codeg:// uris) to their label", () => {
    expect(
      formatConversationTitle("[My chat](codeg://session/codex_abc)")
    ).toBe("My chat")
    expect(
      formatConversationTitle("[abc1234](codeg://commit/%2Frepo@abc)")
    ).toBe("abc1234")
    // An agent reference keeps the `@` — it lives inside the bracket text.
    expect(formatConversationTitle("[@Codex](codeg://agent/codex)")).toBe(
      "@Codex"
    )
  })

  it("does not touch invocation tokens that are not links", () => {
    expect(formatConversationTitle("@Codex please review")).toBe(
      "@Codex please review"
    )
    expect(formatConversationTitle("run /review on this")).toBe(
      "run /review on this"
    )
  })

  it("handles an angle-bracket-wrapped destination (spaces/parens in the uri)", () => {
    expect(
      formatConversationTitle("[report (1).pdf](<file:///tmp/report (1).pdf>)")
    ).toBe("report (1).pdf")
  })

  it("unescapes Markdown-escaped characters in the label", () => {
    // A label containing `]` and `(` is emitted escaped as `\]` / `\(`.
    expect(formatConversationTitle("[a\\]b\\(c](file:///x)")).toBe("a]b(c")
  })

  it("handles a Windows file uri with escaped backslashes inside <…>", () => {
    // `escapeLinkDestination` doubles every `\` inside `<…>`, so a real emitted
    // Windows path looks like `<file:///C:\\proj\\dir\\>` (the trailing `\\` is
    // an escaped backslash, not an escape of the closing `>`).
    expect(
      formatConversationTitle("[dir](<file:///C:\\\\proj\\\\dir\\\\>)")
    ).toBe("dir")
  })

  it("leaves an unterminated/partial link as-is", () => {
    expect(formatConversationTitle("[oops no close](file:///x")).toBe(
      "[oops no close](file:///x"
    )
    expect(formatConversationTitle("just [brackets]")).toBe("just [brackets]")
  })

  it("leaves a malformed angle destination (no closing >) untouched", () => {
    // The angle branch needs a closing `>`, and the bare branch rejects `<`,
    // so neither matches — the text is not mistaken for a link.
    expect(formatConversationTitle("[a](<unterminated)")).toBe(
      "[a](<unterminated)"
    )
  })

  it("reduces an empty-destination link to its label", () => {
    // `[a]()` is a valid (empty-href) CommonMark link, so it folds to `a`.
    expect(formatConversationTitle("[a]()")).toBe("a")
  })

  it("also reduces an ordinary web link — a raw url never belongs in a title", () => {
    expect(
      formatConversationTitle("see [the docs](https://example.com/x) first")
    ).toBe("see the docs first")
  })

  it("closes a balanced nested-bracket label at the right `]`", () => {
    // The label is `a [b]` (balanced), so it folds to that — not the inner link.
    expect(formatConversationTitle("[a [b]](https://x)")).toBe("a [b]")
    // A bracketed-only label keeps its inner brackets verbatim in the label.
    expect(formatConversationTitle("[[b]](https://x)")).toBe("[b]")
  })

  it("recovers the inner link after an unbalanced outer `[`", () => {
    // `[a ` never balances, but the later `[b](https://x)` is still a valid link
    // and folds to its label; the stray `[a ` is kept as prose. (The shared
    // tokenizer recovers later links instead of giving up at the unmatched `[`.)
    expect(formatConversationTitle("[a [b](https://x)")).toBe("[a b")
  })

  it("does not let a backslash escape whitespace in a destination", () => {
    // A `\` + space / line break is a literal backslash (CommonMark won't escape
    // whitespace), so the destination is malformed and the text is left raw.
    expect(formatConversationTitle("[a](foo\\ bar)")).toBe("[a](foo\\ bar)")
    expect(formatConversationTitle("[a](foo\\\nbar)")).toBe("[a](foo\\\nbar)")
    expect(formatConversationTitle("[a](<\\\n>)")).toBe("[a](<\\\n>)")
    // …but a backslash-escaped `>` inside `<…>` is a real escape and still folds.
    expect(formatConversationTitle("[a](<x\\>y>)")).toBe("a")
  })

  it("stays linear on pathological unmatched-bracket input (no ReDoS)", () => {
    // A regex for `[label](dest)` backtracks super-linearly here; the
    // single-pass parser returns instantly. A quadratic regression would blow
    // vitest's default timeout, so these large malformed inputs guard it.
    const brackets = "[".repeat(100_000)
    expect(formatConversationTitle(brackets)).toBe(brackets)
    const bracketsThenPairs = "[".repeat(50_000) + "](".repeat(200)
    expect(formatConversationTitle(bracketsThenPairs)).toBe(bracketsThenPairs)
    // Repeated unterminated angle destinations: each `<…` must stop at the next
    // `<` rather than scanning to EOF, or this is quadratic.
    const angleAttack = "[a](<".repeat(50_000)
    expect(formatConversationTitle(angleAttack)).toBe(angleAttack)
    // A genuine link after a long prose prefix is still folded.
    const prefix = "x".repeat(50_000)
    expect(formatConversationTitle(`${prefix} [a](file:///a)`)).toBe(
      `${prefix} a`
    )
  })
})

describe("parseStructuredConversationTitle", () => {
  it("splits a stored auto-title into date, kind, and topic", () => {
    expect(parseStructuredConversationTitle("0911｜探索｜项目分析")).toEqual({
      date: "0911",
      kind: "探索",
      topic: "项目分析",
    })
  })

  it("accepts ASCII pipes, extra spaces, and a slash inside the topic", () => {
    expect(parseStructuredConversationTitle("0903 | 优化 | CI/CD")).toEqual({
      date: "0903",
      kind: "优化",
      topic: "CI/CD",
    })
  })

  it("accepts the automation kind", () => {
    expect(
      parseStructuredConversationTitle("0904｜自动｜今天未完成核查")
    ).toEqual({
      date: "0904",
      kind: "自动",
      topic: "今天未完成核查",
    })
  })

  it("rejects prose, slash-only dates, and extra pipes in the topic", () => {
    expect(parseStructuredConversationTitle("检查文字粗细差异")).toBeNull()
    expect(parseStructuredConversationTitle("2024/01/01 meeting")).toBeNull()
    expect(
      parseStructuredConversationTitle("0911｜探索｜项目｜分析")
    ).toBeNull()
    expect(parseStructuredConversationTitle("abcd｜探索｜项目分析")).toBeNull()
  })
})
