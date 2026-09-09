// Exported with the UI, so this identifies the served frontend, not the backend.
export const dynamic = "force-static"

export function GET() {
  return Response.json({ buildId: process.env.NEXT_PUBLIC_FRONTEND_BUILD_ID })
}
