import react from "@vitejs/plugin-react"
import path from "node:path"
const config = {
  root: path.resolve("output/sidebar-actions-qa"),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve("src") } },
  css: { postcss: path.resolve(".") },
  server: { host: "127.0.0.1", port: 4318, fs: { allow: [path.resolve(".")] } },
}

export default config
