"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { isNativeDesktop } from "@/lib/platform"

export default function LoginPage() {
  const router = useRouter()
  const t = useTranslations("LoginPage")
  const [token, setToken] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    document.title = t("documentTitle")
  }, [t])

  // Desktop users skip login entirely
  if (isNativeDesktop()) {
    router.replace("/workspace")
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // Validate token by calling a lightweight API endpoint
      const res = await fetch("/api/health", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "{}",
      })

      if (res.ok) {
        localStorage.setItem("codeg_token", token)
        router.replace("/workspace")
      } else if (res.status === 401) {
        setError(t("invalidToken"))
      } else {
        setError(t("connectionFailed", { status: res.status }))
      }
    } catch {
      setError(t("networkError"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t("brand")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("tokenPlaceholder")}
              autoFocus
              aria-label={t("tokenPlaceholder")}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            disabled={!token || loading}
            size="lg"
            className="w-full"
          >
            {loading ? t("connecting") : t("connect")}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          {t("helpText")}
        </p>
      </div>
    </div>
  )
}
