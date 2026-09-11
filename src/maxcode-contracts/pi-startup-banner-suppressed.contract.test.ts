import { describe, expect, it } from "vitest"

import { source } from "./contract-source"

const CONNECTION = "src-tauri/src/acp/connection.rs"

/**
 * pi-acp announces session startup (pi version, Context files, Skills list) as
 * ONE whole `agent_message_chunk` right after `session/new`, but never writes
 * it to pi's session JSONL. When codeg rendered it as prose, the banner flashed
 * on screen while the turn streamed and vanished the moment the persisted
 * transcript loaded — visible while working, gone when finished. MaxCode
 * contract: the live view must match what the transcript will actually contain,
 * so the banner is dropped from the stream instead of rendered.
 */
describe("MaxCode contract: pi startup banner never renders in the conversation", () => {
  const connection = source(CONNECTION)

  it("routes the session-start banner chunk to Drop in the pi classifier", () => {
    const classifier = connection
      .split("fn pi_message_chunk_route")[1]
      ?.split("/// Recover `(attempt, max, delay_ms)` from `Retrying")[0]
    expect(classifier).toBeTruthy()
    // The banner shares the drop branch with queue announcements; assert the
    // branch body, not just a later Drop somewhere in the source file.
    expect(classifier).toMatch(
      /else if pi_is_startup_prelude\(text\)\s*\|\|\s*pi_is_queue_announcement\(text\)\s*\{\s*PiChunkRoute::Drop\s*\}/
    )
  })

  it("matches only the strict banner opening so real prose survives", () => {
    const helper = connection
      .split("fn pi_is_startup_prelude")[1]
      ?.split("\n}\n")[0]
    expect(helper).toBeTruthy()
    expect(helper).toContain('strip_prefix("pi v")')
    // A digit after `pi v` is what keeps markdown setext headings such as
    // `pi versions\n---` on the prose path — a doc-writing model can emit
    // those as a whole chunk, the real banner always carries a semver.
    expect(helper).toContain("is_ascii_digit()")
    expect(helper).toContain('Some("---")')
  })

  it("keeps the drop pi-gated and covered by a shape inventory test", () => {
    const classifier = connection
      .split("fn pi_message_chunk_route")[1]
      ?.split("/// Recover `(attempt, max, delay_ms)` from `Retrying")[0]
    expect(classifier).toBeTruthy()
    // The whole classifier is pi-only; every other agent's chunk stays prose.
    expect(classifier).toContain("if agent_type != AgentType::Pi")
    // All banner shapes (full banner, version line only, banner + update
    // notice) plus the prose near-misses stay pinned by the Rust unit test.
    expect(connection).toContain(
      "fn pi_startup_prelude_is_dropped_in_every_shape"
    )
    expect(connection).toContain(
      "the Context/Skills banner is the case users actually see"
    )
  })
})
