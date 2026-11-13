"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox"
import { templateLabel } from "@/lib/template"

interface Theme {
  id: number
  name: string
  role: string
  updatedAt: string
}

interface StepTemplatePickerProps {
  storeDomain: string
  accessToken: string
  resolving: boolean
  videoCount: number
  imageCount: number
  selectedKey: string | null
  onTemplateContent: (key: string, content: string) => Promise<void>
  onError: (msg: string) => void
  onResolvingChange: (resolving: boolean) => void
  onSelectionStart: (key: string) => void
  onThemeChange: (themeId: number | null) => void
}

export function StepTemplatePicker({
  storeDomain,
  accessToken,
  resolving,
  videoCount,
  imageCount,
  selectedKey,
  onTemplateContent,
  onError,
  onResolvingChange,
  onSelectionStart,
  onThemeChange,
}: StepTemplatePickerProps) {
  const [themes, setThemes] = useState<Theme[]>([])
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null)
  const [templateKeys, setTemplateKeys] = useState<string[]>([])
  const [loadingThemes, setLoadingThemes] = useState(false)
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  const fetchTemplates = useCallback(
    async (themeId: number) => {
      setLoadingTemplates(true)
      onError("")
      setTemplateKeys([])
      try {
        const res = await fetch("/api/shopify-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeDomain,
            accessToken,
            action: "list-templates",
            themeId,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "获取模板列表失败")
        setTemplateKeys(data.keys ?? [])
      } catch (err) {
        onError(err instanceof Error ? err.message : "获取模板列表失败")
      } finally {
        setLoadingTemplates(false)
      }
    },
    [storeDomain, accessToken, onError]
  )

  const fetchThemes = useCallback(async () => {
    setLoadingThemes(true)
    onError("")
    try {
      const res = await fetch("/api/shopify-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeDomain,
          accessToken,
          action: "list-themes",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "获取主题失败")
      const list: Theme[] = (data.themes ?? []).filter(
        (t: { role: string }) => t.role !== "development"
      )
      setThemes(list)
      const live = list.find((t) => t.role === "main")
      if (live) {
        setSelectedThemeId(live.id)
        onThemeChange(live.id)
        fetchTemplates(live.id)
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "获取主题失败")
    } finally {
      setLoadingThemes(false)
    }
  }, [storeDomain, accessToken, onError, fetchTemplates, onThemeChange])

  const handleSelectTemplate = useCallback(
    async (key: string | null) => {
      if (!key) return
      if (!selectedThemeId) return
      // 解析进行中不接受新的选择，避免两次解析的流式结果互相覆盖
      if (resolving) return
      onSelectionStart(key)
      onResolvingChange(true)
      onError("")
      try {
        const res = await fetch("/api/shopify-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeDomain,
            accessToken,
            action: "get-template",
            themeId: selectedThemeId,
            key,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "获取模板内容失败")
        const content: string = data.content ?? ""
        await onTemplateContent(key, content)
      } catch (err) {
        onError(err instanceof Error ? err.message : "获取模板内容失败")
      } finally {
        onResolvingChange(false)
      }
    },
    [
      selectedThemeId,
      resolving,
      storeDomain,
      accessToken,
      onTemplateContent,
      onError,
      onResolvingChange,
      onSelectionStart,
    ]
  )

  // API 配置有效时自动拉取主题列表
  const isConfigured = !!storeDomain && !!accessToken
  const prevConfiguredRef = useRef(false)
  useEffect(() => {
    if (isConfigured && !prevConfiguredRef.current) {
      fetchThemes()
    }
    prevConfiguredRef.current = isConfigured
  }, [isConfigured, fetchThemes])

  const handleSelectTheme = useCallback(
    (id: string | null) => {
      if (!id) return
      const themeId = Number(id)
      setSelectedThemeId(themeId)
      onThemeChange(themeId)
      fetchTemplates(themeId)
    },
    [fetchTemplates, onThemeChange]
  )

  const sortedThemes = useMemo(
    () =>
      [...themes].sort((a, b) => {
        if (a.role === "main" && b.role !== "main") return -1
        if (a.role !== "main" && b.role === "main") return 1
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }),
    [themes]
  )

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="space-y-4 px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
            1
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">获取模板素材</p>
            <p className="text-xs text-muted-foreground">
              {resolving
                ? "正在解析素材..."
                : videoCount + imageCount > 0
                  ? `已解析 ${videoCount + imageCount} 个文件`
                  : "选择主题和模板，自动解析素材"}
            </p>
          </div>
          {(loadingThemes || loadingTemplates || resolving) && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          )}
        </div>

        {!isConfigured ? (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              尚未配置源店铺，无法拉取主题与模板
            </p>
            <Link href="/config" className="mt-2 inline-block">
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-lg text-xs"
              >
                去店铺配置
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* 主题选择 */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">主题</Label>
              {loadingThemes ? (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
                  加载主题列表...
                </div>
              ) : sortedThemes.length > 0 ? (
                <Select
                  value={selectedThemeId?.toString() ?? ""}
                  onValueChange={handleSelectTheme}
                  disabled={resolving}
                >
                  <SelectTrigger className="w-full py-4">
                    <SelectValue placeholder="选择主题">
                      {(value) =>
                        themes.find((t) => t.id.toString() === value)?.name ??
                        value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    align="center"
                    alignItemWithTrigger={false}
                    className="max-h-72 px-2 py-2"
                  >
                    {sortedThemes.map((theme) => (
                      <SelectItem
                        key={theme.id}
                        value={theme.id.toString()}
                        className="p-2.5 pr-10"
                      >
                        <div className="flex w-full gap-2">
                          <span>{theme.name}</span>
                          <Badge
                            variant="secondary"
                            className={
                              theme.role === "main"
                                ? "bg-[#affebf] text-[10px] text-black dark:text-emerald-400"
                                : "text-[10px] text-[#666666]"
                            }
                          >
                            {theme.role === "main" ? "Live" : theme.role}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
                  未找到主题
                </div>
              )}
            </div>

            {/* 模板选择（带搜索） */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">模板</Label>
              {loadingTemplates ? (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
                  加载模板列表...
                </div>
              ) : templateKeys.length > 0 ? (
                <div
                  className={resolving ? "pointer-events-none opacity-50" : ""}
                >
                  <Combobox
                    value={selectedKey}
                    onValueChange={(v) => handleSelectTemplate(v as string)}
                    items={templateKeys}
                    itemToStringLabel={(key) => templateLabel(key)}
                  >
                    <ComboboxInput placeholder="搜索模板..." className="h-9" />
                    <ComboboxContent className="max-h-72 px-2 py-2">
                      <ComboboxList>
                        {(key: string) => (
                          <ComboboxItem
                            key={key}
                            value={key}
                            className="p-2.5 pr-10"
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate text-sm">
                                {templateLabel(key)}
                              </span>
                              <span className="truncate font-mono text-[11px] text-muted-foreground/60">
                                {key.replace(/^templates\//, "")}
                              </span>
                            </div>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                      <ComboboxEmpty>无匹配模板</ComboboxEmpty>
                    </ComboboxContent>
                  </Combobox>
                </div>
              ) : selectedThemeId ? (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
                  未找到模板
                </div>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
