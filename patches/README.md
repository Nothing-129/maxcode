# Dependency patches

## Streamdown 2.7.1: cancellable highlighting

Selected from Codeg `80fd043f6` and `6677de432`. The code-body effect passes an
optional `AbortSignal` to its highlighter plugin and aborts on code, language,
theme changes or unmount. Both the runtime ESM chunk and TypeScript declaration
are patched. The package is pinned exactly so upgrades cannot silently omit it.

MaxCode's shared Shiki service bounds cached results to 16 MiB / 128 entries and
in-flight work to 16 requests. Obsolete streaming prefixes are not cached.
Markdown and file/tool code views share the engine and cancel subscriptions.
File preview retains its existing 512 KiB / 5,000-line highlighting limits.

Validate with `src/lib/code-highlighter.test.ts`,
`src/lib/code-highlighter-streamdown.test.tsx`, and the independent
`src/maxcode-contracts/upstream-selected-20261111.contract.test.ts`.
Docker must copy `patches/` before its frozen install.

On a Streamdown upgrade, review the lifecycle fix and regenerate or remove this
patch only after checking cancellation and real component unmount behavior.
Tauri and OverlayScrollbars patches from upstream are intentionally not included.
