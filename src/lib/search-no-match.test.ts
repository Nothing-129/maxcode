import { describe, expect, it } from "vitest"

import {
  commandLooksLikeSearch,
  isSearchNoMatchResult,
} from "./search-no-match"

const TRACEBACK = [
  'File "/Library/Developer/CommandLineTools/Library/Frameworks/',
  "Python3.framework/Versions/3.9/lib/python3.9/json/decoder.py",
  '", line 353, in raw_decode',
  "json.decoder.JSONDecodeError: Expecting property name enclosed",
  " in double quotes: line 17 column 27 (char 557)",
].join("\n")

describe("commandLooksLikeSearch", () => {
  it("recognises rg/grep and git grep, including wrappers", () => {
    expect(commandLooksLikeSearch("rg -n 'SdkAppId' src")).toBe(true)
    expect(commandLooksLikeSearch("/usr/bin/rg -n foo")).toBe(true)
    expect(commandLooksLikeSearch("grep -R pattern .")).toBe(true)
    expect(commandLooksLikeSearch("git grep TODO")).toBe(true)
    expect(commandLooksLikeSearch("git -C src grep TODO")).toBe(true)
    expect(
      commandLooksLikeSearch("/bin/zsh -lc 'rg -n \"class InfoVO\" src'")
    ).toBe(true)
    expect(commandLooksLikeSearch("cd src && rg pattern")).toBe(true)
    expect(commandLooksLikeSearch("rg pattern | head -20")).toBe(true)
    expect(commandLooksLikeSearch("FOO=1 rg pattern")).toBe(true)
  })

  it("rejects non-search commands", () => {
    expect(commandLooksLikeSearch("pnpm test")).toBe(false)
    expect(commandLooksLikeSearch("ls src")).toBe(false)
    expect(commandLooksLikeSearch("git status")).toBe(false)
    expect(commandLooksLikeSearch("git log --grep=foo")).toBe(false)
    expect(commandLooksLikeSearch("echo rg")).toBe(false)
  })
})

describe("isSearchNoMatchResult", () => {
  it("remaps a Codex grep envelope (exit 1, empty output)", () => {
    expect(
      isSearchNoMatchResult({
        toolName: "Search for 'absent'",
        output: JSON.stringify({ exit_code: 1, formatted_output: "" }),
        isError: true,
      })
    ).toBe(true)
  })

  it("remaps a native grep tool with an empty failed body", () => {
    expect(
      isSearchNoMatchResult({
        toolName: "grep",
        input: JSON.stringify({ pattern: "absent" }),
        output: "",
        isError: true,
      })
    ).toBe(true)
    expect(
      isSearchNoMatchResult({
        toolName: "grep",
        output: "No files found",
        isError: true,
      })
    ).toBe(true)
  })

  it("remaps a shell rg/grep that exited 1 with no diagnostic", () => {
    const input = JSON.stringify({
      command: "rg -n 'SdkAppId|Callback' src",
    })
    expect(
      isSearchNoMatchResult({
        toolName: "bash",
        input,
        output: JSON.stringify({ exit_code: 1, formatted_output: "" }),
        isError: true,
      })
    ).toBe(true)
    expect(
      isSearchNoMatchResult({
        toolName: "run_terminal_command",
        input,
        output: "",
        isError: true,
      })
    ).toBe(true)
    expect(
      isSearchNoMatchResult({
        toolName: "run_command",
        input: JSON.stringify({ CommandLine: "rg foo" }),
        output: JSON.stringify({
          exitCode: 1,
          exit_code: 1,
          combinedOutput: "",
          formatted_output: "",
        }),
        isError: true,
      })
    ).toBe(true)
  })

  it("keeps genuine failures on the error path", () => {
    expect(
      isSearchNoMatchResult({
        toolName: "bash",
        input: JSON.stringify({ command: "rg -n 'foo' src" }),
        output: TRACEBACK,
        isError: true,
      })
    ).toBe(false)
    expect(
      isSearchNoMatchResult({
        toolName: "grep",
        output: JSON.stringify({
          exit_code: 1,
          formatted_output: "rg: unclosed group",
        }),
        isError: true,
      })
    ).toBe(false)
    expect(
      isSearchNoMatchResult({
        toolName: "grep",
        output: JSON.stringify({ exit_code: 2, formatted_output: "" }),
        isError: true,
      })
    ).toBe(false)
    expect(
      isSearchNoMatchResult({
        toolName: "bash",
        input: JSON.stringify({ command: "pnpm test" }),
        output: JSON.stringify({ exit_code: 1, formatted_output: "" }),
        isError: true,
      })
    ).toBe(false)
    expect(
      isSearchNoMatchResult({
        toolName: "List files",
        output: JSON.stringify({ exit_code: 1, formatted_output: "" }),
        isError: true,
      })
    ).toBe(false)
  })

  it("does not remap a successful tool call", () => {
    expect(
      isSearchNoMatchResult({
        toolName: "grep",
        output: "a.ts:1:hit",
        isError: false,
      })
    ).toBe(false)
  })
})
