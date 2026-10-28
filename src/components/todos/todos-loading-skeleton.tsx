import { Skeleton } from "@/components/ui/skeleton"
import { TODO_COLUMNS } from "./board-columns"

export function TodosLoadingSkeleton({
  label,
  viewMode,
}: {
  label: string
  viewMode: "board" | "list"
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b p-4">
          <Skeleton className="h-8 w-40 motion-reduce:animate-none" />
          <Skeleton className="h-8 w-24 motion-reduce:animate-none" />
          <Skeleton className="ms-auto h-8 w-20 motion-reduce:animate-none" />
        </div>
        <div
          className={
            viewMode === "board"
              ? "flex min-h-0 flex-1 gap-4 overflow-hidden p-4"
              : "space-y-4 overflow-hidden p-4"
          }
        >
          {(viewMode === "board" ? TODO_COLUMNS : ["list"]).map((column) => (
            <div
              key={column}
              className={
                viewMode === "board"
                  ? "min-w-60 flex-1 space-y-4 rounded-2xl bg-muted/35 p-4"
                  : "space-y-4"
              }
            >
              <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
              {Array.from(
                { length: viewMode === "board" ? 3 : 6 },
                (_, row) => (
                  <div
                    key={row}
                    className="space-y-3 rounded-xl border bg-background p-4"
                  >
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-4 shrink-0 rounded-sm motion-reduce:animate-none" />
                      <Skeleton className="h-3 w-3/5 motion-reduce:animate-none" />
                    </div>
                    <Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
                    <Skeleton className="h-3 w-2/5 motion-reduce:animate-none" />
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
