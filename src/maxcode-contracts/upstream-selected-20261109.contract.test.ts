import { describe, expect, it } from "vitest"
import { isConnectionBusy } from "@/lib/connection-teardown"
import { upsertAsyncTask } from "@/lib/async-tasks"
import { loadOfficeAutoPreview } from "@/lib/office-preview-prefs"
import { source } from "./contract-source"

describe("selected November stability fixes", () => {
  const idle = {
    status: "connected",
    backgroundOutstanding: 0,
    asyncTasks: [],
    remoteControl: null,
    delegatedChildren: [],
  }
  it("retains a silent AIR task and reclaims it after completion", () => {
    const tasks = upsertAsyncTask([], {
      task_id: "terminal",
      spawned: true,
      state: "running",
    })
    expect(isConnectionBusy({ ...idle, asyncTasks: tasks })).toBe(true)
    expect(
      isConnectionBusy({
        ...idle,
        asyncTasks: upsertAsyncTask(tasks, {
          task_id: "terminal",
          state: "completed",
          spawned: false,
        }),
      })
    ).toBe(false)
  })
  it("retains a parent until its delegated child settles", () => {
    expect(isConnectionBusy({ ...idle, delegatedChildren: ["child"] })).toBe(
      true
    )
    expect(isConnectionBusy(idle)).toBe(false)
  })
  it("retains Remote Control even without an advertised session URL", () => {
    expect(
      isConnectionBusy({ ...idle, remoteControl: { session_url: null } })
    ).toBe(true)
  })
  it("requires explicit Office preview opt-in", () => {
    localStorage.clear()
    localStorage.setItem("workspace:office-auto-preview", "true")
    expect(loadOfficeAutoPreview()).toBe(false)
    localStorage.setItem("workspace:office-auto-preview:v2", "true")
    expect(loadOfficeAutoPreview()).toBe(true)
    localStorage.clear()
  })
  it("allows Grok scripts in isolated background updates", () => {
    expect(source("src-tauri/src/commands/agent_auto_updates.rs")).toContain(
      'cmd.arg("--allow-scripts=@xai-official/grok")'
    )
  })
  it("registers executable installation and history contracts", () => {
    expect(source("src-tauri/src/commands/acp.rs")).toContain(
      "mod maxcode_november_install;"
    )
    expect(source("src-tauri/src/parsers/deepseek.rs")).toContain(
      "mod maxcode_november_history;"
    )
  })
})
