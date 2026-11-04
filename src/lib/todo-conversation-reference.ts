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

/** Read only the generated standalone reference; prose and code stay literal. */
export function todoConversationReference(content: string): string | null {
  let fence: string | null = null
  for (const line of content.split("\n")) {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
        fence = null
      continue
    }
    if (fence) continue
    const trimmed = line.trim()
    const prefix = referencePrefixes.find((value) => trimmed.startsWith(value))
    if (!prefix) continue
    const url = trimmed.slice(prefix.length).trim()
    if (/^https?:\/\/[^\s/]+\/share#[a-f\d]{32}$/i.test(url)) return url
  }
  return null
}
