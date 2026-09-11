import { describe, expect, it } from "vitest"

import {
  groupByFolderWithReuse,
  worktreeChildrenByParent,
} from "@/components/conversations/sidebar-conversation-grouping"
import type { DbConversationSummary } from "@/lib/types"
import { source } from "./contract-source"

describe("MaxCode contract: imported worktrees retain workspace behavior", () => {
  it("uses the current sidebar grouping without moving a session's cwd or metadata", () => {
    const session: DbConversationSummary = {
      id: 21,
      folder_id: 2,
      title: "保留我的会话标题",
      title_locked: true,
      agent_type: "codex",
      status: "completed",
      kind: "regular",
      model: "custom-model",
      git_branch: "feature/import",
      external_id: "imported-worktree-session",
      message_count: 2,
      child_count: 0,
      created_at: "2026-09-11T00:00:00Z",
      updated_at: "2026-09-11T00:00:00Z",
      pinned_at: null,
    }
    const folders = [
      { id: 1, parent_id: null, sort_order: 0, name: "repo" },
      { id: 2, parent_id: 1, sort_order: 1, name: "worktree" },
    ]
    const merged = groupByFolderWithReuse(
      [session],
      "created",
      new Map(),
      new Map([[2, 1]])
    )
    expect([...merged.keys()]).toEqual([1])
    expect(merged.get(1)?.[0]).toBe(session)
    expect(session.folder_id).toBe(2)
    expect(session.title_locked).toBe(true)
    expect(session.model).toBe("custom-model")

    // The existing "show worktrees" preference keeps its separate bucket.
    const separated = groupByFolderWithReuse([session], "created", new Map())
    expect(separated.get(2)?.[0]).toBe(session)
    expect(worktreeChildrenByParent([1], folders).get(1)).toEqual([2])
  })

  it("parents only to a live root while preserving established folder relationships", () => {
    const backend = source("src-tauri/src/commands/conversations.rs")
    const importer = backend.slice(
      backend.indexOf("pub(crate) async fn import_selected_from_summaries("),
      backend.indexOf("pub async fn import_selected_sessions_core(")
    )
    expect(importer).toContain("worktree_root_key(&target_path)")
    expect(importer).toContain("top_level_parent_ids.contains(parent_id)")
    expect(importer).toContain("Some(*parent_id) != target_folder_id")
    expect(importer).toContain(
      "existing_parent_id == Some(*parent_id) || !target_has_children"
    )
    expect(importer).toContain(
      "None => folder_service::add_folder(conn, &target_path).await"
    )
    expect(importer).toContain("parent_id.or(existing_parent_id)")
    expect(backend).toContain(
      "async fn batch_import_refuses_dangling_or_deleted_flattened_roots()"
    )
    expect(backend).toContain("assert!(worktree < repo)")
  })

  it("retains selection-only restoration, delegated-child filtering and client updates", () => {
    const backend = source("src-tauri/src/commands/conversations.rs")
    const importer = backend.slice(
      backend.indexOf("pub(crate) async fn import_selected_from_summaries("),
      backend.indexOf("pub async fn import_selected_sessions_core(")
    )
    expect(importer).toContain(".filter(|(_, c)| c.parent_id.is_none())")
    expect(importer).toContain("row.map(|r| r.path.clone())")
    expect(importer).toContain("import_service::DeletedPolicy::Restore")
    expect(importer).toContain("import_service::import_summaries_resilient(")
    expect(importer).toContain("emit_folder_upsert(emitter, detail)")
    expect(importer).toContain("CONVERSATIONS_BULK_CHANGED_EVENT")
  })
})
