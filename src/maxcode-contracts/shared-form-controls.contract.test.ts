import { describe, expect, it } from "vitest"
import { source } from "./contract-source"

describe("shared form controls", () => {
  it.each([
    ["components/automations/automation-editor", "SelectTrigger"],
    ["components/automations/automation-todo-picker", "SelectTrigger"],
    ["components/todos/todo-teams-dialog", "SelectTrigger"],
    ["components/conversations/conversation-share-options", "SelectTrigger"],
    ["contexts/git-credential-context", "Checkbox"],
    ["components/settings/mcp-settings", "Checkbox"],
    ["components/chat/question-dialog", "Textarea"],
    ["app/login/page", "Input"],
    ["contexts/workspace-context", "AlertDialog"],
    ["components/tasks/task-settings-dialog", "RadioGroupItem"],
    ["components/settings/delegation-agent-defaults", "TabsTrigger"],
  ])("%s reuses %s", (path, component) => {
    expect(source(`src/${path}.tsx`)).toContain(`<${component}`)
  })
})
