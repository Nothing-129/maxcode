// Shared helpers for web-mode HTTP calls — the JSON transport in
// `web-transport.ts` and direct multipart/file callers in `lib/api.ts` both
// need consistent token retrieval and 401 redirect behavior. Keeping them in
// one place means a future move from `localStorage` to cookies (or rotation
// rules, multi-tenant prefixing, etc.) doesn't have to be remembered at every
// call site.

import { getElectronBridge } from "../electron"

const TOKEN_KEY = "codeg_token"

export function getCodegToken(): string {
  // A fresh token accompanies every managed backend launch. Never use a
  // persisted browser token for Electron, or write this launch secret to disk.
  const electron = getElectronBridge()
  if (electron) return electron.token
  return localStorage.getItem(TOKEN_KEY) ?? ""
}

export function redirectToCodegLogin(): void {
  // The desktop shell owns authentication and backend lifecycle. A login
  // form cannot repair a failed child process or replace its launch token.
  if (getElectronBridge()) return
  if (window.location.pathname.startsWith("/login")) return
  localStorage.removeItem(TOKEN_KEY)
  window.location.href = "/login"
}
