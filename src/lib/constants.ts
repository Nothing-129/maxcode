export const CONNECTION_IDLE_TIMEOUT_MS = 1 * 60 * 1000 // 1 minute
export const IDLE_SWEEP_INTERVAL_MS = 60 * 1000 // 1 minute
// Maximum number of idle, background owner connections kept warm. Tabs and
// persisted conversation state remain open after an LRU eviction; activating
// a cold tab resumes its agent session on demand.
export const MAX_IDLE_WARM_CONNECTIONS = 2
// Active-surface keepalive + read-only background liveness-probe cadence.
// Only the active surface is touched; probing background tabs must not refresh
// their backend idle clock.
export const CONNECTION_KEEPALIVE_INTERVAL_MS = 30 * 1000 // 30 seconds
