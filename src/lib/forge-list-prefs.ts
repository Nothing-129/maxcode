"use client"

const PAGE_SIZE_KEY = "workspace:forge-page-size"

/**
 * Page sizes the workbench offers. Kept small and fixed rather than free-form:
 * both forges cap `per_page` at 100, and the backend clamps anything else, so
 * an arbitrary number would only produce a page the user did not ask for.
 */
export const FORGE_PAGE_SIZES = [10, 20, 30, 50] as const

export type ForgePageSize = (typeof FORGE_PAGE_SIZES)[number]

/** Mirrors `DEFAULT_PER_PAGE` in src-tauri/src/forge/mod.rs. */
export const DEFAULT_FORGE_PAGE_SIZE: ForgePageSize = 20

/** Comments per "load more" — mirrors `DEFAULT_COMMENT_PER_PAGE` in
 *  src-tauri/src/forge/mod.rs. Not offered as a setting: a thread is read
 *  rather than scanned, so there is no equivalent of the list's page size to
 *  remember. */
export const DEFAULT_FORGE_COMMENT_PAGE_SIZE = 20

/** Files per "load more" on a proposed change — mirrors
 *  `DEFAULT_FILES_PER_PAGE` in src-tauri/src/forge/mod.rs. Larger than a
 *  comment page: these are one line each, and a reviewer scanning "what does
 *  this touch" wants the shape of the whole change rather than a paragraph. */
export const DEFAULT_FORGE_FILES_PAGE_SIZE = 50

function isPageSize(value: number): value is ForgePageSize {
  return (FORGE_PAGE_SIZES as readonly number[]).includes(value)
}

/**
 * The remembered page size. Anything unrecognized — a hand-edited entry, or a
 * size a future build offered and this one does not — reads back as the
 * default rather than as a size the selector could not display.
 */
export function loadForgePageSize(): ForgePageSize {
  if (typeof window === "undefined") return DEFAULT_FORGE_PAGE_SIZE
  try {
    const raw = localStorage.getItem(PAGE_SIZE_KEY)
    const parsed = raw == null ? NaN : Number.parseInt(raw, 10)
    return isPageSize(parsed) ? parsed : DEFAULT_FORGE_PAGE_SIZE
  } catch {
    return DEFAULT_FORGE_PAGE_SIZE
  }
}

export function saveForgePageSize(size: ForgePageSize): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size))
  } catch {
    /* ignore */
  }
}
