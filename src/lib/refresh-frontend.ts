/** Reload the document without touching credentials, connections or storage. */
export function refreshFrontend() {
  const url = new URL(window.location.href)
  // Also bypass a previously cached HTML entry from releases without no-cache.
  url.searchParams.set("_frontend_reload", String(Date.now()))
  window.location.replace(url.href)
}
