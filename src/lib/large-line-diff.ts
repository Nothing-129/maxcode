import type { DiffHunk } from "@/components/merge/merge-diff"

// Myers' shortest edit path is cheap when a large file has only a few edits.
// Bound the edit distance so a genuine rewrite still uses the existing fallback.
const MAX_EDIT_DISTANCE = 256

export function computeSparseLineDiff(
  oldLines: string[],
  newLines: string[]
): DiffHunk[] | null {
  const trace: Map<number, number>[] = []
  let frontier = new Map<number, number>([[1, 0]])
  const limit = Math.min(MAX_EDIT_DISTANCE, oldLines.length + newLines.length)

  for (let distance = 0; distance <= limit; distance += 1) {
    const next = new Map<number, number>()
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? -1
      const right = frontier.get(diagonal - 1) ?? -1
      let x =
        diagonal === -distance || (diagonal !== distance && right < down)
          ? down
          : right + 1
      let y = x - diagonal
      while (
        x < oldLines.length &&
        y < newLines.length &&
        oldLines[x] === newLines[y]
      ) {
        x += 1
        y += 1
      }
      next.set(diagonal, x)
      if (x >= oldLines.length && y >= newLines.length) {
        trace.push(next)
        return hunksFromTrace(trace, oldLines, newLines)
      }
    }
    trace.push(next)
    frontier = next
  }
  return null
}

function hunksFromTrace(
  trace: Map<number, number>[],
  oldLines: string[],
  newLines: string[]
): DiffHunk[] {
  const matches: [number, number][] = []
  let x = oldLines.length
  let y = newLines.length

  for (let distance = trace.length - 1; distance > 0; distance -= 1) {
    const previous = trace[distance - 1]
    const diagonal = x - y
    const down = previous.get(diagonal + 1) ?? -1
    const right = previous.get(diagonal - 1) ?? -1
    const previousDiagonal =
      diagonal === -distance || (diagonal !== distance && right < down)
        ? diagonal + 1
        : diagonal - 1
    const previousX = previous.get(previousDiagonal) ?? 0
    const previousY = previousX - previousDiagonal
    const snakeX = previousDiagonal === diagonal + 1 ? previousX : previousX + 1
    const snakeY = snakeX - diagonal
    while (x > snakeX && y > snakeY) {
      matches.push([--x, --y])
    }
    x = previousX
    y = previousY
  }
  while (x > 0 && y > 0) matches.push([--x, --y])
  matches.reverse()

  const hunks: DiffHunk[] = []
  let oldCursor = 0
  let newCursor = 0
  for (const [oldIndex, newIndex] of [
    ...matches,
    [oldLines.length, newLines.length] as [number, number],
  ]) {
    if (oldIndex > oldCursor || newIndex > newCursor) {
      hunks.push({
        baseStart: oldCursor,
        baseCount: oldIndex - oldCursor,
        newLines: newLines.slice(newCursor, newIndex),
      })
    }
    oldCursor = oldIndex + 1
    newCursor = newIndex + 1
  }
  return hunks
}
