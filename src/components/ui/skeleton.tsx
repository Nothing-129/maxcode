import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("maxcode-skeleton bg-muted rounded-xl", className)}
      {...props}
    />
  )
}

export { Skeleton }
