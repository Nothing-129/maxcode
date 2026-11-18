/** Offset from the chip anchor to the composer's actual border, in CSS pixels.
 * Measure both boxes so zoom, padding and tiled layouts do not need magic offsets.
 */
export function composerMenuAlignOffset(
  trigger: Pick<DOMRect, "left" | "right">,
  input: Pick<DOMRect, "left" | "right">,
  rtl = false
): number {
  return rtl ? trigger.right - input.right : input.left - trigger.left
}
