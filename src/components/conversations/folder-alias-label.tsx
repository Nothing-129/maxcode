import { formatFolderLabelWithAlias } from "@/lib/folder-display"

/** Use one display-name rule across sidebar, pickers, headers and tooltips. */
export function FolderAliasLabel({
  name,
  alias,
}: {
  name: string
  alias: string | null
}) {
  return <>{formatFolderLabelWithAlias({ name, alias })}</>
}
