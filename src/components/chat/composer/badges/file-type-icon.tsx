import { fileIconSources, resolveFileIcon } from "@/lib/file-icon"

export function FileTypeIcon({
  path,
  isDirectory = false,
}: {
  path: string
  isDirectory?: boolean
}) {
  const icon = resolveFileIcon(path, isDirectory)
  const sources = fileIconSources(icon)
  return (
    <span
      aria-hidden="true"
      data-file-icon={icon}
      className="mt-[0.12em] inline-flex size-4 shrink-0"
    >
      {/* Local, pre-sized SVG assets need no Next image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sources.light}
        alt=""
        width={16}
        height={16}
        className={
          sources.light === sources.dark ? "size-4" : "size-4 dark:hidden"
        }
      />
      {sources.light !== sources.dark && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sources.dark}
          alt=""
          width={16}
          height={16}
          className="hidden size-4 dark:block"
        />
      )}
    </span>
  )
}
