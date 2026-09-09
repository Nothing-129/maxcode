/** Track the real scroll range, including streamed text and viewport resizing. */
export function observeThreadOverflow(
  viewport: HTMLElement,
  content: HTMLElement,
  onChange: (overflowing: boolean) => void
) {
  let previous: boolean | undefined
  const measure = () => {
    // Ignore subpixel rounding and unmeasured/hidden viewports.
    const overflowing =
      viewport.clientHeight > 0 &&
      viewport.scrollHeight - viewport.clientHeight > 1
    if (overflowing !== previous) {
      previous = overflowing
      onChange(overflowing)
    }
  }
  const observer = new ResizeObserver(measure)
  observer.observe(viewport)
  observer.observe(content)
  measure()
  return () => observer.disconnect()
}
