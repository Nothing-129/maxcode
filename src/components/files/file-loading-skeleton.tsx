import { Skeleton } from "@/components/ui/skeleton"

export function FileLoadingSkeleton({
  label,
  variant = "code",
}: {
  label: string
  variant?: "code" | "diff" | "document" | "list" | "media"
}) {
  const columns = variant === "diff" ? 2 : 1
  return (
    <div
      role="status"
      aria-busy="true"
      className="h-full min-h-0 overflow-hidden"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex h-full divide-x divide-border">
        {Array.from({ length: columns }, (_, column) => (
          <div key={column} className="min-w-0 flex-1 space-y-4 p-4">
            {variant === "media" ? (
              <Skeleton className="mx-auto mt-6 aspect-video w-4/5 rounded-xl motion-reduce:animate-none" />
            ) : (
              Array.from({ length: 12 }, (_, row) => (
                <div key={row} className="flex items-center gap-4">
                  {variant !== "document" && (
                    <Skeleton className="h-3 w-5 shrink-0 rounded-sm motion-reduce:animate-none" />
                  )}
                  <Skeleton
                    className={
                      variant === "list"
                        ? "h-8 rounded-sm motion-reduce:animate-none"
                        : "h-3 rounded-sm motion-reduce:animate-none"
                    }
                    style={{ width: `${[72, 48, 84, 60, 36, 68][row % 6]}%` }}
                  />
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
