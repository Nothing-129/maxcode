import { Skeleton } from "@/components/ui/skeleton"

export function MessageListSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="h-full min-h-0 overflow-hidden"
    >
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="mx-auto maxcode-chat-column space-y-10 px-4 py-6"
      >
        {[0, 1].map((index) => (
          <div key={index} className="space-y-8">
            <Skeleton className="ms-auto h-16 w-3/5 rounded-2xl motion-reduce:animate-none" />
            <div className="space-y-4">
              <Skeleton className="h-3 w-20 motion-reduce:animate-none" />
              <div className="space-y-3">
                <Skeleton className="h-3 w-full motion-reduce:animate-none" />
                <Skeleton className="h-3 w-[92%] motion-reduce:animate-none" />
                <Skeleton className="h-3 w-3/4 motion-reduce:animate-none" />
              </div>
              {index === 0 && (
                <Skeleton className="h-20 w-full rounded-xl motion-reduce:animate-none" />
              )}
              <Skeleton className="h-3 w-2/5 motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
