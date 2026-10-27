import { isValidElement, type ReactNode } from "react"

/** Labels must survive formatting and Streamdown's per-character fade spans. */
export function markdownNodeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children)
  }
  if (Array.isArray(children)) return children.map(markdownNodeText).join("")
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return markdownNodeText(children.props.children)
  }
  return ""
}
