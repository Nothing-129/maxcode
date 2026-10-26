// Prefixes emitted by Todos.conversationLinkContent in all supported locales.
const referencePrefixes = [
  "详情见对话：",
  "詳情見對話：",
  "See conversation:",
  "Veja a conversa:",
  "Voir la conversation :",
  "للتفاصيل، راجع المحادثة:",
  "Details im Gespräch:",
  "詳細は会話を参照：",
  "자세한 내용은 대화를 확인하세요:",
  "Consulta la conversación:",
]

/** Reconcile generated references with the snapshot hosted by the todo owner. */
export function todoContentWithConversationReference(
  content: string,
  sourceUrl: string | null
) {
  if (!sourceUrl) return content
  let fence: string | null = null
  return content
    .split("\n")
    .map((line) => {
      const marker = line.trimStart().match(/^(`{3,}|~{3,})/)
      if (marker) {
        if (!fence) fence = marker[1]
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
          fence = null
        return line
      }
      if (fence) return line
      const trimmed = line.trim()
      const prefix = referencePrefixes.find((value) =>
        trimmed.startsWith(value)
      )
      if (!prefix) return line
      const url = trimmed.slice(prefix.length).trim()
      // Only the generated, standalone MaxCode reference is rewritten.
      if (!/^https?:\/\/[^\s/]+\/share#[a-f\d]{32}$/i.test(url)) return line
      return line.replace(url, () => sourceUrl)
    })
    .join("\n")
}
