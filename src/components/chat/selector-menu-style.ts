// Shared by command, radio and virtualized menus. Keep positioning and keyboard
// semantics with their existing Radix/cmdk implementations.
export const SELECTOR_MENU_SURFACE =
  "gap-0 rounded-2xl border border-border/60 bg-popover p-1.5 text-popover-foreground shadow-[0_8px_32px_-8px_rgb(0_0_0/0.14)] ring-0 max-w-[calc(100vw-1rem)] [scrollbar-width:thin]"

export const SELECTOR_RADIO_ROWS =
  "[&_[data-slot=dropdown-menu-radio-item]]:min-h-8 [&_[data-slot=dropdown-menu-radio-item]]:rounded-xl [&_[data-slot=dropdown-menu-radio-item]]:py-2 [&_[data-slot=dropdown-menu-radio-item]]:pr-9 [&_[data-slot=dropdown-menu-radio-item]]:pl-2.5 [&_[data-slot=dropdown-menu-radio-item]]:focus:bg-muted/80 [&_[data-slot=dropdown-menu-radio-item-indicator]]:right-3 [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:size-4 [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:stroke-[1.5]"
