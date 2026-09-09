import { useTranslations } from "next-intl"

export function FolderRunningIndicator({
  expanded,
  runningCount,
}: {
  expanded: boolean
  runningCount: number
}) {
  const t = useTranslations("Folder.sidebar")
  if (expanded || runningCount <= 0) return null

  const label = t("runningCountBadge", { count: runningCount })
  return (
    <span
      data-folder-running
      title={label}
      className="ml-auto inline-flex shrink-0 items-center justify-center"
    >
      <svg
        data-running-spinner
        className="size-3 animate-spin text-[#858585] dark:text-[#a3a3a3]"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="6"
          cy="6"
          r="4.5"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="1.5"
        />
        <path
          d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}
