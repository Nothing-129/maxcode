import { describe, expect, it } from "vitest"
import {
  isFailedTurnVerdict,
  rejectedPromptText,
} from "./acp-error-presentation"

describe("isFailedTurnVerdict", () => {
  it("is the verdicts where nothing came back or the agent would not run", () => {
    for (const code of [
      "turn_failed_auth_required",
      "turn_failed_empty",
      "turn_failed_empty_protocol",
      "turn_failed_empty_metadata",
      "turn_failed_unknown",
    ]) {
      expect(isFailedTurnVerdict(code)).toBe(true)
    }
  })

  it("is not a turn that ended early with output, nor any other code", () => {
    for (const code of [
      "turn_failed_refusal",
      "turn_failed_max_tokens",
      "turn_failed_max_turn_requests",
      "set_mode_failed",
      null,
      undefined,
    ]) {
      expect(isFailedTurnVerdict(code)).toBe(false)
    }
  })
})

describe("rejectedPromptText", () => {
  it("drops the prefix the backend's protocol error adds", () => {
    expect(rejectedPromptText("ACP protocol error: API key expired.")).toBe(
      "API key expired."
    )
  })

  it("leaves any other message as it is", () => {
    expect(rejectedPromptText("API key expired.")).toBe("API key expired.")
  })
})
