export const CONNECTION_IDLE_TIMEOUT_MS = 1 * 60 * 1000 // 1 minute
export const IDLE_SWEEP_INTERVAL_MS = 60 * 1000 // 1 minute
// Maximum number of idle, background owner connections kept warm. Tabs and
// persisted conversation state remain open after an LRU eviction; activating
// a cold tab resumes its agent session on demand.
export const MAX_IDLE_WARM_CONNECTIONS = 2
// A warm slot is temporary: keep it alive long enough for normal task
// switching, then reclaim it even when the two-slot budget is not full.
export const IDLE_WARM_CONNECTION_TTL_MS = 10 * 60 * 1000 // 10 minutes
// Active-surface + selected warm-slot keepalive cadence. Other background tabs
// get a read-only liveness probe that never refreshes their backend idle clock.
export const CONNECTION_KEEPALIVE_INTERVAL_MS = 30 * 1000 // 30 seconds
