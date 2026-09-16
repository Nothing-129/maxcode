import { describe, expect, it } from "vitest"

import { UPLOAD_MAX_BYTES } from "@/lib/api"
import { source } from "./contract-source"

describe("MaxCode contract: 100 MiB attachments", () => {
  it("keeps picker, desktop drag/drop, server and remote uploads at 100 MiB", () => {
    expect(UPLOAD_MAX_BYTES).toBe(104_857_600)
    expect(source("src/lib/api.ts")).toContain(
      "UPLOAD_MAX_BYTES = 100 * 1024 * 1024"
    )
    for (const path of ["src-tauri/src/web/handlers/files.rs"]) {
      expect(source(path)).toContain(
        "UPLOAD_MAX_BYTES: u64 = 100 * 1024 * 1024"
      )
    }
  })

  it("allows multipart overhead and can hydrate a maximum-sized image", () => {
    expect(source("src-tauri/src/web/router.rs")).toContain(
      "DefaultBodyLimit::max(UPLOAD_MAX_BYTES as usize + 64 * 1024)"
    )
    expect(source("src-tauri/src/acp/prompt_hydration.rs")).toContain(
      "HYDRATION_TOTAL_MAX_BYTES: u64 = UPLOAD_MAX_BYTES"
    )
  })
})
