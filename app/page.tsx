"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  type MediaFile,
  type SavedConfig,
  type ResolveResult,
  STORAGE_KEY,
  LAST_USED_KEY,
  getSavedConfigsFromStorage,
  getLastUsedConfigFromStorage,
} from "@/lib/types"
import { parseMediaUrls } from "@/lib/parse"
import JSZip from "jszip"
import {
  IconVideo,
  IconImage,
  IconDownload,
  IconCheck,
  IconChevronDown,
} from "@/components/icons"
import { MediaCard } from "@/components/media-card"
import { TemplateDialog } from "@/components/template-dialog"
import { PreviewDialog } from "@/components/preview-dialog"

// ── 主页面 ──────────────────────────────────────────────────────────────

/** 触发浏览器保存文件 */
function triggerSave(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export default function Page() {
  const [jsonInput, setJsonInput] = useState("")
  const [videos, setVideos] = useState<MediaFile[]>([])
  const [error, setError] = useState("")
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [configExpanded, setConfigExpanded] = useState(true)

  // 预览状态
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // 主题模板 Dialog
  const [tplDialogOpen, setTplDialogOpen] = useState(false)

  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState("")
  const [storeDomain, setStoreDomain] = useState("")
  const [accessToken, setAccessToken] = useState("")
  const [configName, setConfigName] = useState("")

  useEffect(() => {
    setMounted(true)
    const configs = getSavedConfigsFromStorage()
    setSavedConfigs(configs)
    const lastConfig = getLastUsedConfigFromStorage()
    if (lastConfig) {
      setSelectedConfigId(lastConfig.id)
      setStoreDomain(lastConfig.storeDomain)
      setAccessToken(lastConfig.accessToken)
      setConfigName(lastConfig.name)
      setConfigExpanded(false) // 有配置时默认折叠
    }
  }, [])

  const saveConfigs = useCallback((configs: SavedConfig[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
      setSavedConfigs(configs)
    } catch {
      console.error("Failed to save configs")
    }
  }, [])

  const handleSelectConfig = useCallback(
    (id: string | null) => {
      const configId = id || ""
      setSelectedConfigId(configId)
      if (configId === "" || configId === "__new__") {
        setStoreDomain("")
        setAccessToken("")
        setConfigName("")
        setSelectedConfigId("")
        localStorage.removeItem(LAST_USED_KEY)
        return
      }
      const config = savedConfigs.find((c) => c.id === configId)
      if (config) {
        setStoreDomain(config.storeDomain)
        setAccessToken(config.accessToken)
        setConfigName(config.name)
        localStorage.setItem(LAST_USED_KEY, configId)
      }
    },
    [savedConfigs],
  )

  const handleSaveConfig = useCallback(() => {
    if (!storeDomain || !accessToken) {
      setError("请填写店铺域名和 API Token")
      return
    }
    const name = configName || storeDomain
    const id = selectedConfigId || Date.now().toString()
    const newConfig: SavedConfig = {
      id,
      name,
      storeDomain,
      accessToken,
    }
    const existingIndex = savedConfigs.findIndex((c) => c.id === id)
    let newConfigs: SavedConfig[]
    if (existingIndex >= 0) {
      newConfigs = [...savedConfigs]
      newConfigs[existingIndex] = newConfig
    } else {
      newConfigs = [...savedConfigs, newConfig]
    }
    saveConfigs(newConfigs)
    setSelectedConfigId(id)
    setConfigName(name)
    setError("")
    localStorage.setItem(LAST_USED_KEY, id)
  }, [
    storeDomain,
    accessToken,
    configName,
    selectedConfigId,
    savedConfigs,
    saveConfigs,
  ])

  const handleDeleteConfig = useCallback(() => {
    if (!selectedConfigId) return
    const newConfigs = savedConfigs.filter((c) => c.id !== selectedConfigId)
    saveConfigs(newConfigs)
    setSelectedConfigId("")
    setStoreDomain("")
    setAccessToken("")
    setConfigName("")
    localStorage.removeItem(LAST_USED_KEY)
  }, [selectedConfigId, savedConfigs, saveConfigs])

  const [resolving, setResolving] = useState(false)

  const handleParse = useCallback(
    async (content?: string) => {
      setError("")
      try {
        const parsed = parseMediaUrls(content ?? jsonInput)

        if (parsed.length === 0) {
          setVideos([])
          setError("未找到素材文件（视频或图片）")
          return
        }

        // 直接可用的 URL 先标记
        const direct = parsed.map((f) => ({
          ...f,
          resolvedUrl: /^https?:\/\//i.test(f.url) ? f.url : null,
        }))

        // 找出需要通过 API 解析的 shopify:// URL
        const shopifyUrls = direct
          .filter((f) => !f.resolvedUrl)
          .map((f) => f.url)

        if (shopifyUrls.length > 0) {
          if (!storeDomain || !accessToken) {
            setError("存在 shopify:// 协议的文件，请先配置 API 凭证再解析")
            setVideos(direct)
            return
          }

          setResolving(true)
          setVideos(direct) // 先显示列表（shopify:// 的显示加载中）

          const failures: string[] = []

          // 收到一条就点亮一个文件，不等整批
          const applyResolved = (items: ResolveResult[]) => {
            if (items.length === 0) return
            const resolveMap = new Map(items.map((r) => [r.original, r]))

            setVideos((prev) =>
              prev.map((f) => {
                if (f.resolvedUrl) return f
                const hit = resolveMap.get(f.url)
                if (!hit?.resolved) return f
                // 保留原始文件名（shopify:// 路径的 basename 就是它）。
                // 视频的 CDN URL 里是哈希名，千万不能用它反推文件名。
                return {
                  ...f,
                  resolvedUrl: hit.resolved,
                  name: hit.filename || f.name,
                }
              }),
            )
          }

          const collect = (items: ResolveResult[]) => {
            for (const item of items) {
              if (!item.resolved) {
                failures.push(item.error || `无法解析 ${item.original}`)
              }
            }
            applyResolved(items)
          }

          try {
            const res = await fetch("/api/shopify-resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storeDomain,
                accessToken,
                urls: shopifyUrls,
              }),
            })

            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              throw new Error(data.error || "解析链接失败")
            }
            if (!res.body) throw new Error("解析链接失败")

            // 服务端按 NDJSON 逐行推送。这里读一行点亮一个，所以界面是
            // 「一个个出现」，而不是全部一起卡到最慢的那个才变亮。
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            for (;;) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? "" // 最后一段可能是半行，留到下一轮

              collect(
                lines
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .flatMap((line) => {
                    try {
                      return [JSON.parse(line) as ResolveResult]
                    } catch {
                      return [] // 半行/坏行直接跳过
                    }
                  }),
              )
            }

            // 收尾：最后一行可能没有以换行结束
            const tail = buffer.trim()
            if (tail) {
              try {
                const item = JSON.parse(tail) as ResolveResult
                collect([item])
              } catch {
                // 不完整的一行，忽略
              }
            }

            if (failures.length > 0) setError(failures.join("\n\n"))
          } catch (err) {
            setError(err instanceof Error ? err.message : "解析链接失败")
          } finally {
            setResolving(false)
          }
        } else {
          setVideos(direct)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "解析失败")
      }
    },
    [jsonInput, storeDomain, accessToken],
  )

  const handleToggle = useCallback((url: string) => {
    setVideos((prev) =>
      prev.map((v) => (v.url === url ? { ...v, selected: !v.selected } : v)),
    )
  }, [])

  const handleSelectAll = useCallback(() => {
    setVideos((prev) => prev.map((v) => ({ ...v, selected: true })))
  }, [])

  const handleDeselectAll = useCallback(() => {
    setVideos((prev) => prev.map((v) => ({ ...v, selected: false })))
  }, [])

  const handleToggleType = useCallback(
    (type: "video" | "image", select: boolean) => {
      setVideos((prev) =>
        prev.map((v) => (v.type === type ? { ...v, selected: select } : v)),
      )
    },
    [],
  )

  const selectedCount = videos.filter((v) => v.selected).length
  const videoCount = videos.filter((v) => v.type === "video").length
  const imageCount = videos.filter((v) => v.type === "image").length

  const videoList = useMemo(
    () => videos.filter((v) => v.type === "video"),
    [videos],
  )
  const imageList = useMemo(
    () => videos.filter((v) => v.type === "image"),
    [videos],
  )

  const handleDownload = useCallback(async () => {
    const selected = videos.filter((v) => v.selected)
    if (selected.length === 0) return
    if (!storeDomain || !accessToken) {
      setError("请先填写店铺域名和 API Token")
      return
    }

    /** 服务端回退：走 /api/shopify-videos（当客户端 CORS 被拦截时） */
    const serverFallback = async () => {
      const response = await fetch("/api/shopify-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeDomain,
          accessToken,
          videoUrls: selected.map((v) => ({
            url: v.resolvedUrl || v.url,
            name: v.name,
          })),
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        const errorDetails = data.details
          ? Array.isArray(data.details)
            ? data.details.join("\n")
            : JSON.stringify(data.details)
          : ""
        throw new Error(
          `${data.error}${errorDetails ? ":\n" + errorDetails : ""}`,
        )
      }
      const blob = await response.blob()
      triggerSave(
        blob,
        selected.length === 1
          ? selected[0].name
          : `shopify-assets-${Date.now()}.zip`,
      )
    }

    setDownloading(true)
    setDownloadProgress(null)
    setError("")
    try {
      if (selected.length === 1) {
        // ── 单文件：客户端直接下载 ──
        const file = selected[0]
        const url = file.resolvedUrl || file.url
        try {
          const res = await fetch(url)
          if (!res.ok) throw new Error(`${res.status}`)
          const blob = await res.blob()
          triggerSave(blob, file.name)
        } catch {
          // CORS 或网络失败，走服务端回退
          await serverFallback()
        }
      } else {
        // ── 多文件：客户端逐个下载 + 打包 ZIP ──
        setDownloadProgress({ current: 0, total: selected.length })
        const zip = new JSZip()
        const errors: string[] = []
        let clientFailed = false

        for (let i = 0; i < selected.length; i++) {
          const file = selected[i]
          setDownloadProgress({
            current: i + 1,
            total: selected.length,
          })
          const url = file.resolvedUrl || file.url
          try {
            const res = await fetch(url)
            if (!res.ok) {
              errors.push(`${file.name}: HTTP ${res.status}`)
              continue
            }
            const buf = await res.arrayBuffer()
            zip.file(file.name, buf)
          } catch (fetchErr) {
            // 第一个文件就 CORS 失败，直接走服务端回退
            if (i === 0) {
              clientFailed = true
              break
            }
            errors.push(
              `${file.name}: ${fetchErr instanceof Error ? fetchErr.message : "下载失败"}`,
            )
          }
        }

        if (clientFailed) {
          await serverFallback()
          return
        }

        if (errors.length > 0) {
          zip.file("下载失败记录.txt", errors.join("\n\n"))
        }
        const zipBlob = await zip.generateAsync({ type: "blob" })
        triggerSave(zipBlob, `shopify-assets-${Date.now()}.zip`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败")
    } finally {
      setDownloading(false)
      setDownloadProgress(null)
    }
  }, [videos, storeDomain, accessToken])

  // ── 预览 ─────────────────────────────────────────────────────────────
  // 视频和图片都直接用 CDN 地址。Shopify 的 CDN 是公开读的（图片本来就是这么
  // 加载的），交给浏览器发 range 请求，视频就能立刻开播、也能拖进度条。
  // 走 API 转成 blob 的话得先把整个文件下完才播得起来，大视频基本没法用。
  const handlePreview = useCallback((file: MediaFile) => {
    const src = file.resolvedUrl
    if (!src) {
      setError(`「${file.name}」还没有解析出地址，无法预览`)
      return
    }

    // 图片加 width 参数加速；视频不能加，会破坏 range 请求
    const url =
      file.type === "image" &&
      src.includes("cdn.shopify.com") &&
      !src.includes("width=")
        ? src + (src.includes("?") ? "&" : "?") + "width=1200"
        : src

    setPreviewFile(file)
    setPreviewUrl(url)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewFile(null)
    setPreviewUrl(null)
  }, [])

  /** 从主题获取 —— 获取到内容后自动填入并解析 */
  const handleTemplateFilled = useCallback(
    (content: string) => {
      setJsonInput(content)
      handleParse(content)
    },
    [handleParse],
  )

  // ── Loading skeleton ────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  // ── 已配置状态的摘要 ────────────────────────────────────────────────
  const isConfigured = !!storeDomain && !!accessToken

  return (
    <div className="relative min-h-screen bg-background">
      {/* 顶部渐变装饰 */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[400px] bg-gradient-to-b from-primary/[0.03] to-transparent dark:from-primary/[0.05]" />

      {/* ── 顶栏 ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background">
              <IconDownload className="h-4 w-4" />
            </div>
            <div>
              <span className="text-sm font-semibold tracking-tight">
                Shopify Asset Downloader
              </span>
              <p className="text-[10px] text-muted-foreground/60">
                模板素材批量下载工具
              </p>
            </div>
          </div>
          {isConfigured && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              已连接
            </span>
          )}
        </div>
      </header>

      <main className="relative mx-auto max-w-4xl space-y-6 px-6 py-10">
        {/* ── Step 1: API 配置 ──────────────────────────────────────────── */}
        <Card className="overflow-hidden border-border/50 shadow-sm">
          <button
            onClick={() => setConfigExpanded((p) => !p)}
            className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-muted/40"
          >
            <div className="flex items-center gap-3">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isConfigured
                    ? "bg-emerald-500 text-white"
                    : "bg-foreground text-background"
                }`}
              >
                {isConfigured ? <IconCheck className="h-3.5 w-3.5" /> : "1"}
              </span>
              <div>
                <CardTitle className="text-sm">API 配置</CardTitle>
                {!configExpanded && isConfigured && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {configName || storeDomain}
                  </p>
                )}
              </div>
            </div>
            <IconChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                configExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {configExpanded && (
            <CardContent className="space-y-4 border-t px-6 pt-5 pb-6">
              {savedConfigs.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    已保存配置
                  </Label>
                  <Select
                    value={selectedConfigId}
                    onValueChange={handleSelectConfig}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择或新建配置" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__new__">+ 新建配置</SelectItem>
                      {savedConfigs.map((config) => (
                        <SelectItem key={config.id} value={config.id}>
                          {config.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="configName"
                    className="text-xs text-muted-foreground"
                  >
                    配置名称
                  </Label>
                  <Input
                    id="configName"
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    placeholder="可选"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="storeDomain"
                    className="text-xs text-muted-foreground"
                  >
                    店铺域名
                  </Label>
                  <Input
                    id="storeDomain"
                    value={storeDomain}
                    onChange={(e) => setStoreDomain(e.target.value)}
                    placeholder="xxx.myshopify.com"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="accessToken"
                  className="text-xs text-muted-foreground"
                >
                  Admin API Access Token
                </Label>
                <Input
                  id="accessToken"
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="shpka_xxxxxxxxxxxxxxxxxxxx"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button onClick={handleSaveConfig} size="sm">
                  保存配置
                </Button>
                {selectedConfigId && (
                  <Button
                    onClick={handleDeleteConfig}
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    删除
                  </Button>
                )}
              </div>
            </CardContent>
          )}
        </Card>

        {/* ── Step 2: JSON 输入 ────────────────────────────────────────── */}
        <Card className="border-border/50 shadow-sm">
          <CardContent className="space-y-4 px-6 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                  2
                </span>
                <div>
                  <p className="text-sm font-medium">粘贴 JSON 模板</p>
                  <p className="text-xs text-muted-foreground">
                    手动粘贴，或从主题 API 直接获取
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={!storeDomain || !accessToken}
                onClick={() => setTplDialogOpen(true)}
              >
                <svg
                  className="h-3.5 w-3.5"
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
                从主题获取
              </Button>
            </div>

            <Textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='{ "video_url": "shopify://files/videos/example.mp4", "image": "https://cdn.shopify.com/.../image.png" }'
              className="max-h-60 min-h-24 resize-y font-mono text-xs leading-relaxed"
            />

            <div className="flex items-center gap-3">
              <Button
                onClick={() => handleParse()}
                disabled={resolving}
                className="gap-2"
              >
                {resolving ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    解析链接中...
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4"
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
                    解析素材
                  </>
                )}
              </Button>
              {videos.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  已解析 {videos.length} 个文件
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── 错误提示 ───────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 backdrop-blur-sm">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
            <p className="whitespace-pre-wrap text-sm text-destructive">
              {error}
            </p>
          </div>
        )}

        {/* ── 素材列表 ───────────────────────────────────────────────── */}
        {videos.length > 0 && (
          <Card className="border-border/50 shadow-sm">
            <CardContent className="space-y-5 px-6 py-5">
              {/* 标题行 */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                    3
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {videos.length} 个文件
                    </span>
                    <div className="flex gap-1.5">
                      {videoCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/8 px-2 py-0.5 text-[11px] font-medium text-blue-500 dark:text-blue-400">
                          <IconVideo className="h-3 w-3" />
                          {videoCount}
                        </span>
                      )}
                      {imageCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/8 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                          <IconImage className="h-3 w-3" />
                          {imageCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={
                      selectedCount === videos.length
                        ? handleDeselectAll
                        : handleSelectAll
                    }
                  >
                    {selectedCount === videos.length
                      ? "取消全选"
                      : `全选 (${videos.length})`}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 rounded-lg text-xs"
                    onClick={handleDownload}
                    disabled={selectedCount === 0 || downloading}
                  >
                    {downloading ? (
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    ) : (
                      <IconDownload className="h-3.5 w-3.5" />
                    )}
                    {downloadProgress
                      ? `下载中 (${downloadProgress.current}/${downloadProgress.total})`
                      : "下载"}
                    {selectedCount > 0 && (
                      <span className="rounded-full bg-primary-foreground/20 px-1.5 py-px text-[10px] font-medium">
                        {selectedCount}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {/* ── 视频 ── */}
              {videoList.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <IconVideo className="h-4 w-4 text-blue-500" />
                      <span className="text-sm font-medium">
                        视频 · {videoList.length}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-muted-foreground"
                      onClick={() => {
                        const allSelected = videoList.every((v) => v.selected)
                        handleToggleType("video", !allSelected)
                      }}
                    >
                      {videoList.every((v) => v.selected)
                        ? "取消全选"
                        : "全选"}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {videoList.map((file) => (
                      <MediaCard
                        key={file.url}
                        file={file}
                        onToggle={() => handleToggle(file.url)}
                        onPreview={() => handlePreview(file)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── 图片 ── */}
              {imageList.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <IconImage className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm font-medium">
                        图片 · {imageList.length}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] text-muted-foreground"
                      onClick={() => {
                        const allSelected = imageList.every((v) => v.selected)
                        handleToggleType("image", !allSelected)
                      }}
                    >
                      {imageList.every((v) => v.selected)
                        ? "取消全选"
                        : "全选"}
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {imageList.map((file) => (
                      <MediaCard
                        key={file.url}
                        file={file}
                        onToggle={() => handleToggle(file.url)}
                        onPreview={() => handlePreview(file)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* ── 预览 Dialog ──────────────────────────────────────────────── */}
      <PreviewDialog
        file={previewFile}
        previewUrl={previewUrl}
        onClose={closePreview}
      />

      {/* ── 主题模板 Dialog ─────────────────────────────────────────── */}
      <TemplateDialog
        open={tplDialogOpen}
        onOpenChange={setTplDialogOpen}
        storeDomain={storeDomain}
        accessToken={accessToken}
        onFilled={handleTemplateFilled}
      />
    </div>
  )
}
