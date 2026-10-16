"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toErrorMessage } from "@/lib/app-error"
import {
  emptyMinioConfig,
  todoStorageConfig,
  type TodoMinioConfig,
} from "@/lib/todo-storage"

export function TodoMinioFields({
  value,
  onChange,
  disabled,
  prefix = "minio",
}: {
  value: TodoMinioConfig
  onChange: (value: TodoMinioConfig) => void
  disabled?: boolean
  prefix?: string
}) {
  const t = useTranslations("Todos")
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-3 rounded-xl border p-3"
    >
      <legend className="px-1 text-sm font-medium">{t("minioTitle")}</legend>
      <p className="text-xs leading-5 text-muted-foreground">
        {t("minioHint")}
      </p>
      {(
        [
          "endpoint",
          "bucket",
          "public_url",
          "access_key",
          "secret_key",
          "region",
        ] as const
      ).map((key) => (
        <div key={key} className="space-y-1">
          <Label htmlFor={`${prefix}-${key}`}>{t(`minio_${key}`)}</Label>
          <Input
            id={`${prefix}-${key}`}
            type={key === "secret_key" ? "password" : "text"}
            autoComplete="off"
            value={value[key]}
            placeholder={
              key === "secret_key" && value.has_secret
                ? t("minioKeepSecret")
                : key === "endpoint"
                  ? "https://minio.example.com:9000"
                  : key === "public_url"
                    ? "https://files.example.com/my-bucket"
                    : undefined
            }
            required={key !== "secret_key" || !value.has_secret}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.value })
            }
          />
        </div>
      ))}
    </fieldset>
  )
}

export function TodoMinioSettings({ scopeId }: { scopeId: string }) {
  const t = useTranslations("Todos")
  const [value, setValue] = useState(emptyMinioConfig)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void todoStorageConfig(scopeId)
      .then((config) => {
        if (active) setValue(config ?? emptyMinioConfig())
      })
      .catch((cause) => {
        if (active) setError(toErrorMessage(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [scopeId])
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (loading || saving) return
        setSaving(true)
        setError(null)
        setSaved(false)
        try {
          const result = await todoStorageConfig(scopeId, value)
          if (result) setValue(result)
          setSaved(true)
        } catch (cause) {
          setError(toErrorMessage(cause))
        } finally {
          setSaving(false)
        }
      }}
    >
      <TodoMinioFields
        prefix="existing-minio"
        value={value}
        onChange={(config) => {
          setValue(config)
          setSaved(false)
        }}
        disabled={loading || saving}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("operationFailed", { reason: error })}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("minioSaved")}
        </p>
      )}
      <Button type="submit" size="sm" disabled={loading || saving}>
        {t(saving ? "saving" : "minioSave")}
      </Button>
    </form>
  )
}
