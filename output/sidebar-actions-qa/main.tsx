import { createRoot } from "react-dom/client"
import { SidebarNavButton } from "./buttons"
import { SidebarWordmark } from "@/components/layout/sidebar-wordmark"
import "@/app/globals.css"
function App() {
  return (
    <div
      style={{
        width: 421,
        padding: "12px 6px 22px",
        background: "var(--sidebar)",
      }}
    >
      <div className="mb-3 flex h-8 items-center px-2">
        <SidebarWordmark />
      </div>
      <div data-sidebar-actions className="flex items-center gap-1">
        <SidebarNavButton icon="compose" label="新对话" onClick={() => {}} />
        <SidebarNavButton icon="clock" label="自动任务" onClick={() => {}} />
        <SidebarNavButton icon="tasks" label="待办" onClick={() => {}} />
      </div>
      <div className="px-2 pt-6 text-xs text-muted-foreground">最近</div>
    </div>
  )
}
createRoot(document.getElementById("root")!).render(<App />)
