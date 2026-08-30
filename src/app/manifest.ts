import type { MetadataRoute } from "next"

// Required for `output: "export"`: metadata routes must be fully static.
export const dynamic = "force-static"

// PWA manifest, consumed by browsers in server / Docker / remote-desktop web
// mode (Tauri desktop ignores it). Keep the pre-rounded transparent icon for
// generic launchers, and provide a separate white-backed maskable icon whose
// logo stays inside Android's safe zone. `?v=` busts launcher icon caches.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MaxCode",
    short_name: "MaxCode",
    description: "AI Coding Agent Conversation Manager",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#2a3348",
    theme_color: "#09090b",
    icons: [
      {
        src: "/icon-192.png?v=14",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png?v=14",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-192.png?v=14",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png?v=14",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
