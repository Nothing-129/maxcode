import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { NextIntlClientProvider } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import {
  TodoMinioFields,
  TodoMinioSettings,
} from "@/components/todos/todo-minio-settings"
import { emptyMinioConfig, todoStorageConfig } from "@/lib/todo-storage"
import en from "@/i18n/messages/en.json"
vi.mock("@/lib/todo-storage", async (original) => ({
  ...(await original<typeof import("@/lib/todo-storage")>()),
  todoStorageConfig: vi.fn(),
}))
beforeEach(() => {
  vi.mocked(todoStorageConfig).mockReset()
})
const config = {
  ...emptyMinioConfig(),
  endpoint: "https://minio.test",
  bucket: "files",
  public_url: "https://cdn.test/files",
  access_key: "access",
  has_secret: true,
}

describe("Creator-managed MinIO settings", () => {
  it("requires all creation fields including the secret key", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TodoMinioFields value={emptyMinioConfig()} onChange={vi.fn()} />
      </NextIntlClientProvider>
    )
    for (const label of [
      "S3 API endpoint",
      "Bucket",
      "File URL base (including bucket)",
      "Access Key",
      "Secret Key",
      "Region",
    ]) {
      expect(screen.getByLabelText(label)).toBeRequired()
    }
    expect(screen.getByLabelText("Secret Key")).toHaveAttribute(
      "type",
      "password"
    )
  })
  it("loads redacted configuration and preserves a saved secret when left blank", async () => {
    vi.mocked(todoStorageConfig).mockResolvedValue(config)
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TodoMinioSettings scopeId="team-a" />
      </NextIntlClientProvider>
    )
    await waitFor(() =>
      expect(screen.getByLabelText("S3 API endpoint")).toHaveValue(
        config.endpoint
      )
    )
    expect(screen.getByLabelText("Secret Key")).toHaveValue("")
    expect(screen.getByLabelText("Secret Key")).not.toBeRequired()
    fireEvent.change(screen.getByLabelText("Bucket"), {
      target: { value: "new-bucket" },
    })
    await userEvent.click(
      screen.getByRole("button", { name: "Save MinIO settings" })
    )
    await screen.findByRole("status")
    expect(todoStorageConfig).toHaveBeenLastCalledWith("team-a", {
      ...config,
      bucket: "new-bucket",
      secret_key: "",
    })
  })
  it("shows configuration failures and keeps typed values for retry", async () => {
    vi.mocked(todoStorageConfig)
      .mockResolvedValueOnce(config)
      .mockRejectedValueOnce(new Error("Cannot save credentials"))
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TodoMinioSettings scopeId="team-a" />
      </NextIntlClientProvider>
    )
    await waitFor(() => expect(screen.getByLabelText("Bucket")).toBeEnabled())
    fireEvent.change(screen.getByLabelText("Bucket"), {
      target: { value: "my-bucket" },
    })
    await userEvent.click(
      screen.getByRole("button", { name: "Save MinIO settings" })
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot save credentials"
    )
    expect(screen.getByLabelText("Bucket")).toHaveValue("my-bucket")
  })
  it("keeps creator controls local, credentials off member responses, and forwards no client-selected scope", () => {
    const ui = readFileSync(
      "src/components/todos/todo-teams-dialog.tsx",
      "utf8"
    )
    expect(ui).toContain("activeTeam?.is_local")
    expect(ui).toContain("minio_config: minio")
    const backend = readFileSync("src-tauri/src/todo/storage.rs", "utf8")
    expect(backend).toContain("config.secret_key.clear()")
    expect(backend).toContain("crate::keyring_store::set_token")
    const handlers = readFileSync("src-tauri/src/web/handlers/todo.rs", "utf8")
    expect(handlers).toContain("todo::storage::member_scope")
    expect(handlers).toContain("let (name, mime, bytes, _, content)")
    const origin = readFileSync(
      "src/components/todos/todo-source-detail-dialog.tsx",
      "utf8"
    )
    expect(origin).toContain("scopeId={origin.scope_id}")
  })
})
