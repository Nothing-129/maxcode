import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("MaxCode contract: folderless chat automations", () => {
  it("offers chat without forcing a folder or exposing Git controls", () => {
    const editor = source("src/components/automations/automation-editor.tsx")
    expect(editor).toContain(
      'allLabel={action === "launch_session" ? t("targetChat") : undefined}'
    )
    expect(editor).toContain(
      'if (action === "enqueue_task" && folderId == null)'
    )
    expect(editor).toContain("folderId != null &&")
    expect(editor).toContain("automation.root_folder_id")
  })
  it("executes chat runs before Git resolution and records chat conversations", () => {
    const engine = source("src-tauri/src/automation/engine.rs")
    expect(engine).toContain(
      "return resolve_chat_cwd(&self.db, &self.data_dir).await"
    )
    expect(engine).toContain("conversation_service::create_chat(")
    expect(engine).toContain("mod maxcode_automation_chat_contract;")
    const page = source("src/components/automations/automations-page.tsx")
    expect(page).toContain("openTab(")
    expect(page).toContain("detail.summary.folder_id")
  })
})
