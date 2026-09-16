import { Suspense } from "react"

export default function ProjectBootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense>
      <>{children}</>
    </Suspense>
  )
}
