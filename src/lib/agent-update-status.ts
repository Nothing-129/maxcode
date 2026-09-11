/** Compare published versions without mistaking an unknown local version for latest. */
export function compareAgentVersions(
  installed: string | null,
  latest: string,
  calendarCorrections = false
): number | null {
  const parse = (input: string | null) => {
    const value = input?.trim().replace(/^v/i, "")
    if (!value) return null
    const normalized = calendarCorrections
      ? value.replace(/-(\d+)(?=\+|$)/, ".$1")
      : value
    const match =
      /^(\d+(?:\.\d+){1,3})(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z.-]+)?$/.exec(
        normalized
      )
    return match
      ? { core: match[1].split(".").map(Number), pre: match[2]?.split(".") }
      : null
  }
  const left = parse(installed)
  const right = parse(latest)
  if (!left || !right) return null
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (diff) return Math.sign(diff)
  }
  if (!left.pre && !right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const a = left.pre[i]
    const b = right.pre[i]
    if (a === b) continue
    if (a === undefined) return -1
    if (b === undefined) return 1
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b))
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}
