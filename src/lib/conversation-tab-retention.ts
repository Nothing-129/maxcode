export interface ConversationTabRetentionInput {
  visible: boolean
  status: string | null
  isViewer: boolean
  backgroundOutstanding: number
  hasPendingInteraction: boolean
}

export interface ConversationTabRetention {
  mounted: boolean
  preserveOwnedConnectionOnUnmount: boolean
}

/**
 * Keep the heavy conversation tree only while it is visible or owns work that
 * still needs an interactive surface. A hidden, idle owner can unmount its UI
 * while the provider keeps the lightweight ACP connection warm.
 */
export function getConversationTabRetention({
  visible,
  status,
  isViewer,
  backgroundOutstanding,
  hasPendingInteraction,
}: ConversationTabRetentionInput): ConversationTabRetention {
  const hasProtectedWork =
    status === "connecting" ||
    status === "prompting" ||
    backgroundOutstanding > 0 ||
    hasPendingInteraction
  const mounted = visible || hasProtectedWork

  return {
    mounted,
    preserveOwnedConnectionOnUnmount:
      !mounted && !isViewer && status === "connected",
  }
}
