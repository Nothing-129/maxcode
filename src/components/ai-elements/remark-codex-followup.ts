import { CODEX_FOLLOWUP_PREFIX } from "./codex-followup"

type Node = {
  type: string
  children?: Node[]
  position?: { start: { offset?: number }; end: { offset?: number } }
  value?: string
  url?: string
}

// Only whole paragraph directives are controls. Source offsets preserve quotes,
// backslashes and Markdown inside prompts; code/inline-code nodes never match.
export function remarkCodexFollowup() {
  return (tree: Node, file: { value: unknown }) => {
    const source = String(file.value)
    function walk(node: Node) {
      if (node.type === "paragraph" && node.position) {
        const raw = source.slice(
          node.position.start.offset,
          node.position.end.offset
        )
        const match = raw.match(
          /^:{1,2}codex-followup\[([^\]\r\n]+)\]\{prompt="((?:[^"\\]|\\.)*)"\s*\}\s*$/
        )
        if (match) {
          let prompt: string
          try {
            prompt = JSON.parse(`"${match[2]}"`)
          } catch {
            return
          }
          if (!prompt.trim() || !match[1].trim()) return
          node.children = [
            {
              type: "link",
              url: CODEX_FOLLOWUP_PREFIX + encodeURIComponent(prompt.trim()),
              children: [{ type: "text", value: match[1] }],
            },
          ]
          return
        }
      }
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree)
  }
}
