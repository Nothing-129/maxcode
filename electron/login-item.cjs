// Electron owns the OS registration; never mirror it into renderer preferences.
function createLoginItem(
  app,
  platform = process.platform,
  execPath = process.execPath
) {
  const supported = app.isPackaged && ["darwin", "win32"].includes(platform)
  // NSIS installs a stable executable, without Squirrel's Update.exe stub.
  const options = platform === "win32" ? { path: execPath, args: [] } : {}
  function get() {
    if (!supported)
      return { supported: false, enabled: false, needsApproval: false }
    const settings = app.getLoginItemSettings(options)
    const needsApproval =
      platform === "darwin"
        ? settings.status === "requires-approval"
        : settings.openAtLogin && !settings.executableWillLaunchAtLogin
    return {
      supported: true,
      enabled: Boolean(settings.openAtLogin || needsApproval),
      needsApproval: Boolean(needsApproval),
    }
  }
  function set(enabled) {
    if (typeof enabled !== "boolean") throw new TypeError("Expected a boolean")
    if (!supported)
      throw new Error(
        "Launch at login requires a packaged macOS or Windows app"
      )
    app.setLoginItemSettings({ ...options, openAtLogin: enabled })
    const state = get()
    if (state.enabled !== enabled)
      throw new Error("The system did not apply the login item setting")
    return state
  }
  return { get, set }
}
module.exports = { createLoginItem }
