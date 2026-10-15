"use client"

import { useEffect } from "react"
import { registerAppServiceWorker } from "@/lib/service-worker"

/** Register the production web worker once, excluding Electron. */
export function PwaRegister() {
  useEffect(() => {
    void registerAppServiceWorker()
  }, [])

  return null
}
