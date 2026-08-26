import { beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_SECTION_ORDER,
  loadSectionCollapsed,
  loadSectionOrder,
  loadShowRecent,
  loadSortMode,
  moveSectionInOrder,
  normalizeSectionOrder,
  saveSectionOrder,
  saveShowRecent,
} from "./sidebar-view-mode-storage"

const SECTION_ORDER_KEY = "workspace:sidebar-section-order"
const SHOW_RECENT_KEY = "workspace:sidebar-show-recent"
const SORT_MODE_KEY = "workspace:sidebar-sort-mode"

describe("normalizeSectionOrder", () => {
  it("passes a complete order through unchanged", () => {
    expect(normalizeSectionOrder(["recent", "chats", "folders"])).toEqual([
      "recent",
      "chats",
      "folders",
    ])
  })

  it("appends missing sections in default order", () => {
    // Forward compatibility in reverse: a store written before "Recent" existed
    // gets it at the bottom rather than losing the section entirely.
    expect(normalizeSectionOrder(["chats", "folders"])).toEqual([
      "chats",
      "folders",
      "recent",
    ])
  })

  it("drops unknown entries and repeats", () => {
    expect(
      normalizeSectionOrder(["recent", "bogus", "recent", 7, null, "chats"])
    ).toEqual(["recent", "chats", "folders"])
  })

  it("migrates the legacy two-way strings, preserving the user's choice", () => {
    expect(normalizeSectionOrder("chats-first")).toEqual([
      "chats",
      "folders",
      "recent",
    ])
    expect(normalizeSectionOrder("folders-first")).toEqual(
      DEFAULT_SECTION_ORDER
    )
  })

  it("falls back to the default for anything unusable", () => {
    expect(normalizeSectionOrder(undefined)).toEqual(DEFAULT_SECTION_ORDER)
    expect(normalizeSectionOrder("nonsense")).toEqual(DEFAULT_SECTION_ORDER)
    expect(normalizeSectionOrder({ folders: 1 })).toEqual(DEFAULT_SECTION_ORDER)
    expect(normalizeSectionOrder([])).toEqual(DEFAULT_SECTION_ORDER)
  })
})

describe("moveSectionInOrder", () => {
  const order = ["folders", "chats", "recent"] as const

  it("moves a section one slot in either direction", () => {
    expect(moveSectionInOrder(order, "recent", -1)).toEqual([
      "folders",
      "recent",
      "chats",
    ])
    expect(moveSectionInOrder(order, "folders", 1)).toEqual([
      "chats",
      "folders",
      "recent",
    ])
  })

  it("moves across multiple slots", () => {
    expect(moveSectionInOrder(order, "recent", -2)).toEqual([
      "recent",
      "folders",
      "chats",
    ])
  })

  it("returns the SAME reference for a move that would fall off an end", () => {
    // Identity matters: the sidebar skips the state update and the localStorage
    // write when a clamped nudge changes nothing.
    expect(moveSectionInOrder(order, "folders", -1)).toBe(order)
    expect(moveSectionInOrder(order, "recent", 1)).toBe(order)
    expect(moveSectionInOrder(order, "chats", 0)).toBe(order)
  })
})

describe("section-order persistence", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips through localStorage", () => {
    saveSectionOrder(["recent", "folders", "chats"])
    expect(loadSectionOrder()).toEqual(["recent", "folders", "chats"])
  })

  it("defaults to Folders → Chat → Recent with nothing stored", () => {
    expect(loadSectionOrder()).toEqual(["folders", "chats", "recent"])
  })

  it("migrates a legacy bare string left by an older build", () => {
    // The old format was not JSON, so the loader must survive the parse failure
    // rather than resetting the user's preference.
    localStorage.setItem(SECTION_ORDER_KEY, "chats-first")
    expect(loadSectionOrder()).toEqual(["chats", "folders", "recent"])
  })

  it("falls back to the default for corrupt JSON", () => {
    localStorage.setItem(SECTION_ORDER_KEY, "{oops")
    expect(loadSectionOrder()).toEqual(DEFAULT_SECTION_ORDER)
  })
})

describe("loadShowRecent", () => {
  beforeEach(() => localStorage.clear())

  it("defaults to on", () => {
    expect(loadShowRecent()).toBe(true)
  })

  it("respects an explicitly-stored false", () => {
    saveShowRecent(false)
    expect(localStorage.getItem(SHOW_RECENT_KEY)).toBe("false")
    expect(loadShowRecent()).toBe(false)
    saveShowRecent(true)
    expect(loadShowRecent()).toBe(true)
  })
})

describe("loadSortMode", () => {
  beforeEach(() => localStorage.clear())

  it("defaults to updated time", () => {
    expect(loadSortMode()).toBe("updated")
  })

  it("respects an explicitly stored created-time preference", () => {
    localStorage.setItem(SORT_MODE_KEY, "created")
    expect(loadSortMode()).toBe("created")
  })
})

describe("loadSectionCollapsed", () => {
  beforeEach(() => localStorage.clear())

  it("reads the recent section's collapsed flag", () => {
    localStorage.setItem(
      "workspace:sidebar-section-collapsed",
      JSON.stringify({ recent: true, chats: false, bogus: 1 })
    )
    expect(loadSectionCollapsed()).toEqual({ recent: true, chats: false })
  })
})
