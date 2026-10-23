/** Upstream-style staggered dots; the caller supplies the accessible status. */
export function WaitingDots() {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1.5 py-1">
      <span className="maxcode-waiting-dot size-1.5 rounded-full bg-muted-foreground/60" />
      <span className="maxcode-waiting-dot size-1.5 rounded-full bg-muted-foreground/60" />
      <span className="maxcode-waiting-dot size-1.5 rounded-full bg-muted-foreground/60" />
    </span>
  )
}
