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
      className="mt-[0.1em] inline-flex size-5 shrink-0"
    >
      {/* Local, pre-sized SVG assets need no Next image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sources.light}
        alt=""
        width={20}
        height={20}
        className={
          sources.light === sources.dark ? "size-5" : "size-5 dark:hidden"
        }
      />
      {sources.light !== sources.dark && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sources.dark}
          alt=""
          width={20}
          height={20}
          className="hidden size-5 dark:block"
        />
      )}
    </span>
  )
}
