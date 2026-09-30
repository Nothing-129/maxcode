import path from "node:path"
import { defineConfig } from "vitest/config"

// State benchmarks deliberately skip jsdom, React setup and the unit suite.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    benchmark: {
      include: ["benchmarks/**/*.bench.ts"],
    },
  },
})
