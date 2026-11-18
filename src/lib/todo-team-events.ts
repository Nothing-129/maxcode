import { getCodegToken } from "@/lib/transport/web-auth"

const RECONNECT_DELAY_MS = 2_000
const FALLBACK_INTERVAL_MS = 60_000

// The local backend owns team credentials and proxies this stream from the host.
export function subscribeRemoteTodoChanges(
  teamId: string,
  refresh: () => void
) {
  const controller = new AbortController()
  let retry: ReturnType<typeof setTimeout> | undefined

  const connect = async () => {
    let receivedNotification = false
    try {
      const response = await fetch("/api/todo_team_events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getCodegToken()}`,
        },
        body: JSON.stringify({ team_id: teamId }),
        priority: "low",
        signal: controller.signal,
      })
      if (
        !response.ok ||
        !response.headers
          .get("Content-Type")
          ?.startsWith("text/event-stream") ||
        !response.body
      ) {
        await response.body?.cancel()
        return
      }

      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader()
      let buffer = ""
      let refreshFrame = false
      try {
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read()
          if (done || controller.signal.aborted) break
          buffer += value
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const rawLine of lines) {
            const line = rawLine.replace(/\r$/, "")
            if (!line) {
              if (refreshFrame) {
                receivedNotification = true
                refresh()
              }
              refreshFrame = false
            } else if (line === "data: refresh") {
              refreshFrame = true
            }
          }
          if (buffer.length > 4096) break
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
    } catch {
      // An unreachable host or interrupted stream is retried below.
    } finally {
      if (!controller.signal.aborted) {
        retry = setTimeout(
          () => {
            // Older hosts have only the state endpoint. Keep it usable while
            // retrying the stream so an upgraded host is picked up automatically.
            if (!receivedNotification) refresh()
            void connect()
          },
          receivedNotification ? RECONNECT_DELAY_MS : FALLBACK_INTERVAL_MS
        )
      }
    }
  }
  void connect()
  return () => {
    controller.abort()
    clearTimeout(retry)
  }
}
