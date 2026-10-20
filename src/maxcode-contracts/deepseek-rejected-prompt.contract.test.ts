import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

describe("MaxCode rejected DeepSeek prompts remain in history", () => {
  it("registers the executable history and image preservation contracts", () => {
    expect(source("src-tauri/src/parsers/deepseek.rs")).toContain(
      "mod rejected_prompt_contract;"
    )
    const contract = source(
      "src/maxcode-contracts/deepseek-rejected-prompt.contract.rs"
    )
    expect(contract).toContain(
      "fn rejected_image_prompt_survives_reopen_before_later_native_turn()"
    )
    expect(contract).toContain(
      "fn rejected_prompt_alone_still_lists_as_a_conversation()"
    )
  })
})
