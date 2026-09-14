"use client"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"

const TEMPLATE_NAMES: Record<string, string> = {
  "templates/index.json": "首页",
  "templates/product.json": "商品页",
  "templates/collection.json": "集合页",
  "templates/collections.json": "集合列表",
  "templates/page.json": "页面",
  "templates/cart.json": "购物车",
  "templates/blog.json": "博客",
  "templates/article.json": "文章",
  "templates/list-collections.json": "集合列表",
  "templates/search.json": "搜索页",
  "templates/404.json": "404 页面",
  "templates/password.json": "密码页",
}

function templateLabel(key: string) {
  if (TEMPLATE_NAMES[key]) return TEMPLATE_NAMES[key]
  return key
    .replace(/^templates\//, "")
    .replace(/^sections\//, "section/")
    .replace(/\.json$/, "")
}

export function TemplateDialog({
  open,
  onOpenChange,
  storeDomain,
  accessToken,
  onFilled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  storeDomain: string
  accessToken: string
  onFilled: (content: string) => void
}) {
  const [step, setStep] = useState(1)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [themes, setThemes] = useState<
    { id: number; name: string; role: string }[]
  >([])
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null)
  const [templateKeys, setTemplateKeys] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // 用 ref 保存 onFilled，避免回调更新导致 fetchThemes 重新创建
  const onFilledRef = useRef(onFilled)
  useEffect(() => {
    onFilledRef.current = onFilled
  }, [onFilled])

  /** 拉取主题列表 */
  const fetchThemes = useCallback(async () => {
    setLoading(true)
    setError("")
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
      const list: { id: number; name: string; role: string }[] =
        data.themes ?? []
      setThemes(list)
      return list
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取主题失败")
      return []
    } finally {
      setLoading(false)
    }
  }, [storeDomain, accessToken])

  /** 拉取选中主题的模板列表 */
  const fetchTemplates = useCallback(
    async (themeId: number) => {
      setLoading(true)
      setError("")
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
        setError(err instanceof Error ? err.message : "获取模板列表失败")
      } finally {
        setLoading(false)
      }
    },
    [storeDomain, accessToken],
  )

  /** 拉取模板内容并填入 */
  const fetchTemplateContent = useCallback(
    async (themeId: number, key: string) => {
      setLoading(true)
      setError("")
      try {
        const res = await fetch("/api/shopify-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeDomain,
            accessToken,
            action: "get-template",
            themeId,
            key,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "获取模板内容失败")
        const content: string = data.content ?? ""
        onOpenChange(false)
        onFilledRef.current(content)
      } catch (err) {
        setError(err instanceof Error ? err.message : "获取模板内容失败")
      } finally {
        setLoading(false)
      }
    },
    [storeDomain, accessToken, onOpenChange],
  )

  /** live (main) 主题排最前 */
  const sortedThemes = useMemo(
    () =>
      [...themes].sort((a, b) => {
        if (a.role === "main" && b.role !== "main") return -1
        if (a.role !== "main" && b.role === "main") return 1
        return 0
      }),
    [themes],
  )

  /** 打开时：有在线主题直接跳到模板列表 */
  const didInitRef = useRef(false)
  useEffect(() => {
    if (!open) {
      didInitRef.current = false
      return
    }
    if (didInitRef.current) return
    didInitRef.current = true
    ;(async () => {
      setSelectedKey(null)
      setError("")
      setSearch("")
      const list = await fetchThemes()
      const live = list.find((t) => t.role === "main")
      if (live) {
        setSelectedThemeId(live.id)
        setStep(2)
        fetchTemplates(live.id)
      } else {
        setSelectedThemeId(null)
        setStep(1)
      }
    })()
  }, [open, fetchThemes, fetchTemplates])

  const resetToThemes = () => {
    setStep(1)
    setSelectedKey(null)
    setSearch("")
    setError("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden border-border/50 p-0 shadow-2xl sm:max-w-2xl"
        showCloseButton={false}
      >
        {/* 标题 */}
        <div className="flex items-center gap-2.5 border-b border-border/50 px-5 py-3.5">
          <svg
            className="h-4 w-4 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" x2="12" y1="15" y2="3" />
          </svg>
          <span className="text-sm font-medium">从主题获取模板</span>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {step} / 3
          </span>
        </div>

        {/* 内容 */}
        <div className="overflow-hidden px-4 py-4">
          {error && (
            <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Step 1: 选主题 */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">选择一个主题</p>
              {loading && sortedThemes.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                  加载主题列表...
                </div>
              ) : sortedThemes.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  未找到主题
                </p>
              ) : (
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {sortedThemes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className={`flex w-full max-w-full items-center gap-3 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        selectedThemeId === theme.id
                          ? "border-primary bg-primary/5"
                          : "border-transparent hover:bg-muted/50"
                      }`}
                      onClick={() => setSelectedThemeId(theme.id)}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {theme.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          theme.role === "main"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {theme.role === "main" ? "Live" : theme.role}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2: 选模板 */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  选择模板
                  {selectedThemeId && (
                    <span className="ml-1 text-muted-foreground/50">
                      · {themes.find((t) => t.id === selectedThemeId)?.name}
                    </span>
                  )}
                </p>
              </div>

              {/* 搜索框 */}
              <div className="relative">
                <svg
                  className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索模板..."
                  className="h-8 pl-8 text-xs"
                />
              </div>

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                  加载模板列表...
                </div>
              ) : templateKeys.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  未找到模板
                </p>
              ) : (() => {
                const q = search.toLowerCase()
                const filtered = q
                  ? templateKeys.filter(
                      (k) =>
                        k.toLowerCase().includes(q) ||
                        templateLabel(k).toLowerCase().includes(q),
                    )
                  : templateKeys

                return filtered.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    无匹配模板
                  </p>
                ) : (
                  <div className="max-h-60 space-y-1 overflow-x-hidden overflow-y-auto">
                    {filtered.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`flex w-full max-w-full flex-col gap-1 overflow-hidden rounded-lg border px-3 py-2 text-left transition-colors ${
                          selectedKey === key
                            ? "border-primary bg-primary/5"
                            : "border-transparent hover:bg-muted/50"
                        }`}
                        onClick={() => setSelectedKey(key)}
                      >
                        <span className="min-w-0 max-w-full truncate text-sm">
                          {templateLabel(key)}
                        </span>
                        <span className="hidden min-w-0 max-w-full shrink truncate font-mono text-[10px] text-muted-foreground/50 sm:block">
                          {key}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Step 3: 加载中 */}
          {step === 3 && (
            <div className="flex flex-col items-center gap-3 py-10">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                正在获取模板内容...
              </span>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between border-t border-border/50 px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              if (step === 2) {
                resetToThemes()
              } else {
                onOpenChange(false)
              }
            }}
          >
            {step === 2 ? "上一步" : "取消"}
          </Button>

          {step === 1 && (
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={!selectedThemeId || loading}
              onClick={() => {
                if (selectedThemeId) {
                  setStep(2)
                  setSearch("")
                  fetchTemplates(selectedThemeId)
                }
              }}
            >
              下一步
            </Button>
          )}

          {step === 2 && (
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={!selectedKey || loading}
              onClick={() => {
                if (selectedThemeId && selectedKey) {
                  setStep(3)
                  fetchTemplateContent(selectedThemeId, selectedKey)
                }
              }}
            >
              获取并填入
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
