import { render, screen, cleanup } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SettingsShell } from "@/components/settings/settings-shell"
import { source } from "./contract-source"

const runtime = vi.hoisted(() => ({ environment: "electron" }))
vi.mock("@/lib/transport/detect", () => ({
  detectEnvironment: () => runtime.environment,
}))
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/general",
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))
vi.mock("@/components/layout/app-title-bar", () => ({
  AppTitleBar: () => null,
}))
vi.mock("@/components/ui/app-toaster", () => ({ AppToaster: () => null }))
afterEach(cleanup)

describe("desktop Web service for phone access", () => {
  it.each(["electron", "tauri"])(
    "keeps the Web service entry in %s",
    (environment) => {
      runtime.environment = environment
      render(
        <SettingsShell>
          <div>Settings</div>
        </SettingsShell>
      )
      expect(
        screen.getByRole("button", { name: "nav.web_service" })
      ).toBeVisible()
    }
  )

  it("does not offer desktop listener controls in the phone browser", () => {
    runtime.environment = "web"
    render(
      <SettingsShell>
        <div>Settings</div>
      </SettingsShell>
    )
    expect(screen.queryByRole("button", { name: "nav.web_service" })).toBeNull()
  })

  it("keeps the private transport separate and restores saved public listener settings", () => {
    const server = source("src-tauri/src/bin/codeg_server.rs")
    expect(server).toContain("let shutdown_signal = if electron.is_some()")
    expect(server).toContain(
      "Arc::new(codeg_lib::web::shutdown::ShutdownSignal::new())"
    )
    expect(server).toContain("Ok(config) if config.auto_start")
    expect(server).toContain("codeg_lib::web::do_start_web_server_with_state(")
    expect(server).toContain(
      "codeg_lib::web::do_stop_web_server(&state.web_server_state).await"
    )
    const handlers = source("src-tauri/src/web/handlers/web_server.rs")
    expect(handlers).toContain("if crate::update::runtime::is_electron()")
    expect(handlers).toContain("crate::web::do_start_web_server_with_state(")
  })
})
