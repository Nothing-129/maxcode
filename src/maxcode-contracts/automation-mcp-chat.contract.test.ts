import { describe, expect, it } from "vitest"
import tools from "../../src-tauri/src/acp/delegation/tool_schema.json"

describe("MCP automation chat target discovery", () => {
  it("advertises chat and project targets without requiring a project path", () => {
    const tool = tools.find((tool) => tool.name === "create_automation")!
    const properties = tool.inputSchema.properties as Record<
      string,
      { type: string; enum?: string[] }
    >
    expect(properties.target.type).toBe("string")
    expect(properties.target.enum).toEqual(["project", "chat"])
    expect(tool.inputSchema.required).toEqual(["name", "prompt"])
  })
})
