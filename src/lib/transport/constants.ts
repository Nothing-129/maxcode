// WS wire-protocol constants used by `WebTransport`.
// The string values MUST stay in sync with their
// Rust counterparts in `src-tauri/src/web/ws.rs` — drift will break the
// server→client handshake silently.
export const WS_READY_CHANNEL = "__ready__"
