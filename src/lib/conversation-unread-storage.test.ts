import { beforeEach, describe, expect, it } from "vitest"

import {
  clearUnreadConversationIds,
  conversationUnreadStorageKey,
  loadUnreadConversationIds,
  saveUnreadConversationIds,
} from "./conversation-unread-storage"

describe("conversation-unread-storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("round-trips integer ids and drops junk", () => {
    saveUnreadConversationIds([3, 1, 1, 0, -4, 2.5, 2])
    expect(loadUnreadConversationIds()).toEqual([3, 1, 2])
  })

  it("treats missing or corrupt payloads as empty", () => {
    expect(loadUnreadConversationIds()).toEqual([])
    localStorage.setItem(conversationUnreadStorageKey(), "{nope")
    expect(loadUnreadConversationIds()).toEqual([])
    localStorage.setItem(conversationUnreadStorageKey(), '"x"')
    expect(loadUnreadConversationIds()).toEqual([])
  })

  it("clears the persisted key", () => {
    saveUnreadConversationIds([9])
    clearUnreadConversationIds()
    expect(localStorage.getItem(conversationUnreadStorageKey())).toBeNull()
    expect(loadUnreadConversationIds()).toEqual([])
  })
})
