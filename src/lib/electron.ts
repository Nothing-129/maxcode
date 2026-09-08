export interface ElectronFileFilter {
  name: string
  extensions: string[]
}

export interface ElectronOpenDialogOptions {
  directory?: boolean
  multiple?: boolean
  title?: string
  defaultPath?: string
  filters?: ElectronFileFilter[]
}

/** The narrow, context-isolated API provided by electron/preload.cjs. */
export interface ElectronBridge {
  readonly platform: string
  readonly version: string
  readonly backendUrl: string
  readonly token: string
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
  revealItemInDir(path: string): Promise<void>
  openFileDialog(options: ElectronOpenDialogOptions): Promise<string[] | null>
  saveFile(
    options: {
      title?: string
      defaultPath?: string
      filters?: ElectronFileFilter[]
    },
    bytes: Uint8Array
  ): Promise<string | null>
  closeWindow(): Promise<void>
  relaunchApp(): Promise<void>
  minimizeWindow(): Promise<void>
  toggleMaximizeWindow(): Promise<void>
  isMaximized(): Promise<boolean>
  notify(title: string, body: string): Promise<boolean>
  openNotificationSettings(): Promise<void>
}

declare global {
  interface Window {
    readonly maxcodeElectron?: ElectronBridge
  }
}

export function getElectronBridge(): ElectronBridge | null {
  return typeof window === "undefined" ? null : (window.maxcodeElectron ?? null)
}

export function isElectron(): boolean {
  return getElectronBridge() !== null
}
