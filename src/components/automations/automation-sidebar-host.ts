"use client"

import { createContext } from "react"

// The route owns selection and editing. Its desktop list renders in the
// workspace's resizable sidebar, while the mobile list uses the same controls.
export const AutomationSidebarHost = createContext<HTMLElement | null>(null)
