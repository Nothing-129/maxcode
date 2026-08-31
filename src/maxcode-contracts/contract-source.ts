import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export function repoPath(path: string): string {
  return resolve(process.cwd(), path)
}

export function source(path: string): string {
  return readFileSync(repoPath(path), "utf8")
}

export function sourceExists(path: string): boolean {
  return existsSync(repoPath(path))
}
