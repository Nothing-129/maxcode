import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_TEAMBITION_SETTINGS,
  loadTeambitionSettings,
  saveTeambitionSettings,
} from "./teambition-settings"

describe("teambition settings", () => {
  beforeEach(() => localStorage.clear())

  it("uses the existing project as the initial default", () => {
    expect(loadTeambitionSettings()).toEqual(DEFAULT_TEAMBITION_SETTINGS)
  })

  it("round trips a selected server and project", () => {
    saveTeambitionSettings({
      serverId: "teambition-openapi-mcp",
      projectId: "project_123",
      projectName: "Product board",
    })
    expect(loadTeambitionSettings()).toEqual({
      serverId: "teambition-openapi-mcp",
      projectId: "project_123",
      projectName: "Product board",
    })
  })

  it("does not load identifiers that could alter the task query", () => {
    localStorage.setItem(
      "workspace:teambition-settings",
      JSON.stringify({ projectId: "x OR isArchived=true" })
    )
    expect(loadTeambitionSettings().projectId).toBe(
      DEFAULT_TEAMBITION_SETTINGS.projectId
    )
  })
})
