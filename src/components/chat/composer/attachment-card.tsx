/** Shared geometry and controls for staged image and file attachments. */
export const ATTACHMENT_CARD_CLASS =
  "inline-flex h-14 w-full min-w-0 items-center gap-2 rounded-xl border border-border/60 bg-muted/50 p-2 pr-7 text-foreground font-normal leading-none transition-colors duration-150 hover:border-foreground/15 hover:bg-muted/80"

export const ATTACHMENT_REMOVE_CLASS =
  "absolute right-1 top-1 flex size-5 items-center justify-center rounded-md bg-background/80 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"

export function AttachmentDetails({
  name,
  type,
}: {
  name: string
  type?: string
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <span className="truncate text-xs font-medium leading-4">{name}</span>
      {type && (
        <span
          aria-hidden="true"
          className="text-[0.625rem] font-medium tracking-[0.06em] text-muted-foreground leading-none"
        >
          {type}
        </span>
      )}
    </span>
  )
}
