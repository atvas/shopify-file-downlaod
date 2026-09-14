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
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog"
import { log } from "console"

interface MediaFile {
  url: string
  name: string
  type: "video" | "image"
  selected: boolean
  resolvedUrl?: string | null
}

interface SavedConfig {
  id: string
  name: string
  storeDomain: string
  accessToken: string
}

/** /api/shopify-resolve 按 NDJSON 逐行推送的条目 */
interface ResolveResult {
  original: string
  resolved: string | null
  filename: string | null
  error?: string
}
function parseMediaUrls(json: string): MediaFile[] {
  const videoPattern = /\.(mp4|webm|mov|avi|m4v)(\?[^"'\s]*)?$/i
  const imagePattern =
    /\.(png|jpg|jpeg|svg|gif|webp|avif|bmp|tiff?)(\?[^"'\s]*)?$/i
  
  // 关键修复 1：严格限制开头 ^ 和结尾 $，防止将包含 URL 的整段 HTML 误判为纯 URL
  const shopifyCdnPattern =
    /^(https?:)?\/\/cdn\.shopify\.com.*\.(mp4|webm|mov|avi|png|jpg|jpeg|svg|gif|webp)(\?[^"'\s]*)?$/i
    
  // 关键修复 2：同步兼容 shopify://files/ 和 shopify://shop_images/
  const shopifyFilePattern = /^shopify:\/\/(files|shop_images)\/.+/i
  
  const items = new Map<string, MediaFile>()

  const mediaExtRe =
    /\.(mp4|webm|mov|avi|m4v|png|jpg|jpeg|svg|gif|webp|avif|bmp|tiff?)/i
  const urlInHtmlRe = new RegExp(
    `(?:src|href|content)=["']([^"']*${mediaExtRe.source}[^"']*)["']`,
    "gi",
  )
  const srcsetUrlRe = new RegExp(`([^"'\\s,]+${mediaExtRe.source})`, "gi")
  const cssUrlRe = new RegExp(
    `url\\(["']?([^"'\\)]*${mediaExtRe.source}[^"'\\)]*)["']?\\)`,
    "gi",
  )

  function tryAddUrl(raw: string): boolean {
    const trimmed = raw.trim()
    if (!trimmed) return false

    // 如果包含 < 字符（说明是 HTML 片段），绝对不作为纯 URL 处理，直接返回 false 走后面的 extractUrlsFromHtml 提取
    if (trimmed.includes("<")) return false

    const clean = trimmed.split("?")[0]

    if (videoPattern.test(trimmed)) {
      items.set(clean, {
        url: clean,
        name: "",
        type: "video",
        selected: false,
      })
      return true
    } else if (imagePattern.test(trimmed)) {
      items.set(clean, {
        url: clean,
        name: "",
        type: "image",
        selected: false,
      })
      return true
    } else if (shopifyCdnPattern.test(trimmed)) {
      const isVideo = /\.(mp4|webm|mov|avi)/i.test(trimmed)
      items.set(clean, {
        url: clean,
        name: "",
        type: isVideo ? "video" : "image",
        selected: false,
      })
      return true
    } else if (shopifyFilePattern.test(trimmed)) {
      const ext = clean.split(".").pop()?.toLowerCase() || ""
      const videoExts = ["mp4", "webm", "mov", "avi", "m4v"]
      items.set(clean, {
        url: clean,
        name: "",
        type: videoExts.includes(ext) ? "video" : "image",
        selected: false,
      })
      return true
    }
    return false
  }

  /**
   * 从 HTML / 纯文本片段中提取所有媒体 URL。
   * 覆盖 src=""、href=""、srcset、CSS url() 等常见嵌入方式。
   */
  function extractUrlsFromHtml(html: string): void {
    let match

    // src="..." / href="..." / content="..."
    urlInHtmlRe.lastIndex = 0
    while ((match = urlInHtmlRe.exec(html)) !== null) {
      tryAddUrl(match[1])
    }

    // srcset — 可能包含多个 URL，用逗号分隔
    srcsetUrlRe.lastIndex = 0
    while ((match = srcsetUrlRe.exec(html)) !== null) {
      tryAddUrl(match[1])
    }

    // CSS url(...)
    cssUrlRe.lastIndex = 0
    while ((match = cssUrlRe.exec(html)) !== null) {
      tryAddUrl(match[1])
    }
  }

  try {
    // 自动去除 Shopify 模板中的 /* */ 块注释和 // 单行注释
    const cleaned = json
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .trim()
    const obj = JSON.parse(cleaned)

    function extractUrls(data: unknown): void {
      if (typeof data === "string") {
        const trimmed = data.trim()
        // 先尝试把整个字符串当作纯 URL，失败了（包括含有 HTML 标签的情况）再进入 HTML 解包逻辑
        if (!tryAddUrl(trimmed)) {
          if (
            trimmed.includes("src=") ||
            trimmed.includes("href=") ||
            trimmed.includes("url(") ||
            trimmed.includes("srcset") ||
            trimmed.includes("<img")
          ) {
            extractUrlsFromHtml(trimmed)
          }
        }
      } else if (Array.isArray(data)) {
        data.forEach(extractUrls)
      } else if (data && typeof data === "object") {
        Object.values(data).forEach(extractUrls)
      }
    }

    extractUrls(obj)
  } catch {
    throw new Error("无效的 JSON 格式")
  }

  for (const item of items.values()) {
    if (!item.name) {
      item.name =
        item.url.split("/").pop()?.split("?")[0] ||
        `unknown.${item.type === "video" ? "mp4" : "png"}`
    }
  }

  return Array.from(items.values())
}


const STORAGE_KEY = "shopify-video-downloader-configs"
const LAST_USED_KEY = "shopify-video-downloader-last-used"

function getSavedConfigsFromStorage(): SavedConfig[] {
  if (typeof window === "undefined") return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function getLastUsedConfigFromStorage(): SavedConfig | null {
  if (typeof window === "undefined") return null
  try {
    const lastUsedId = localStorage.getItem(LAST_USED_KEY)
    if (lastUsedId) {
      const configs = getSavedConfigsFromStorage()
      return configs.find((c) => c.id === lastUsedId) || null
    }
  } catch {
    // ignore
  }
  return null
}

// ── SVG 图标 ────────────────────────────────────────────────────────────
function IconVideo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  )
}

function IconImage({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  )
}

function IconDownload({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
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
  )
}

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconChevronDown({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// ── 主页面 ──────────────────────────────────────────────────────────────
export default function Page() {
  const [jsonInput, setJsonInput] = useState("")
  const [videos, setVideos] = useState<MediaFile[]>([])
  const [error, setError] = useState("")
  const [downloading, setDownloading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [configExpanded, setConfigExpanded] = useState(true)

  // 预览状态
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

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
    [savedConfigs]
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

  const handleParse = useCallback(async () => {
    setError("")
    try {
      const parsed = parseMediaUrls(jsonInput)
      console.log(parsed,"parsed");
      
      if (parsed.length === 0) {
        setError("未找到素材文件（视频或图片）")
        return
      }

      // 直接可用的 URL 先标记
      const direct = parsed.map((f) => ({
        ...f,
        resolvedUrl: /^https?:\/\//i.test(f.url) ? f.url : null,
      }))

      // 找出需要通过 API 解析的 shopify:// URL
      const shopifyUrls = direct.filter((f) => !f.resolvedUrl).map((f) => f.url)

      console.log(shopifyUrls,"shopifyUrls");
      

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
            })
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
                })
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
  }, [jsonInput, storeDomain, accessToken])

  const handleToggle = useCallback((url: string) => {
    setVideos((prev) =>
      prev.map((v) => (v.url === url ? { ...v, selected: !v.selected } : v))
    )
  }, [])

  const handleSelectAll = useCallback(() => {
    setVideos((prev) => prev.map((v) => ({ ...v, selected: true })))
  }, [])

  const handleDeselectAll = useCallback(() => {
    setVideos((prev) => prev.map((v) => ({ ...v, selected: false })))
  }, [])

  const selectedCount = videos.filter((v) => v.selected).length
  const videoCount = videos.filter((v) => v.type === "video").length
  const imageCount = videos.filter((v) => v.type === "image").length

  /** 视频排前面，图片排后面 */
  const sortedVideos = useMemo(
    () => [...videos].sort((a) => (a.type === "video" ? -1 : 1)),
    [videos]
  )

  const handleDownload = useCallback(async () => {
    const selected = videos.filter((v) => v.selected)
    if (selected.length === 0) return
    if (!storeDomain || !accessToken) {
      setError("请先填写店铺域名和 API Token")
      return
    }
    setDownloading(true)
    setError("")
    try {
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
          `${data.error}${errorDetails ? ":\n" + errorDetails : ""}`
        )
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download =
        selected.length === 1
          ? selected[0].name
          : `shopify-assets-${Date.now()}.zip`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载失败")
    } finally {
      setDownloading(false)
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

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closePreview()
    },
    [closePreview]
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
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                2
              </span>
              <div>
                <p className="text-sm font-medium">粘贴 JSON 模板</p>
                <p className="text-xs text-muted-foreground">
                  从 Shopify page/product 模板中复制 JSON 数据
                </p>
              </div>
            </div>

            <Textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='{ "video_url": "shopify://files/videos/example.mp4", "image": "https://cdn.shopify.com/.../image.png" }'
              className="max-h-60 min-h-24 resize-y font-mono text-xs leading-relaxed"
            />

            <div className="flex items-center gap-3">
              <Button
                onClick={handleParse}
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
            <p className="text-sm whitespace-pre-wrap text-destructive">
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
              </div>

              {/* 文件宫格 */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {sortedVideos.map((video) => (
                  <div
                    key={video.url}
                    className="group relative cursor-pointer overflow-hidden rounded-xl border border-border/60 bg-card transition-all duration-200 hover:border-border hover:shadow-lg hover:shadow-black/5"
                    onClick={() => handleToggle(video.url)}
                  >
                    {/* 缩略图 */}
                    <div className="relative aspect-square overflow-hidden bg-muted/30">
                      {video.type === "image" ? (
                        video.resolvedUrl ? (
                          <img
                            src={
                              video.resolvedUrl.includes("cdn.shopify.com")
                                ? video.resolvedUrl +
                                  (video.resolvedUrl.includes("?")
                                    ? "&"
                                    : "?") +
                                  "width=400"
                                : video.resolvedUrl
                            }
                            alt={video.name}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                          </div>
                        )
                      ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-blue-500/[0.04] to-violet-500/[0.04]">
                          <IconVideo className="h-10 w-10 text-blue-400/25" />
                          <span className="text-[10px] text-muted-foreground/40">
                            video
                          </span>
                        </div>
                      )}

                      {/* hover 底部渐变遮罩 + 预览按钮 */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                      <button
                        type="button"
                        className="absolute right-2 bottom-2 flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-white opacity-0 backdrop-blur-md transition-all duration-200 group-hover:opacity-100 hover:scale-110 hover:bg-white/25"
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePreview(video)
                        }}
                      >
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="15 3 21 3 21 9" />
                          <polyline points="9 21 3 21 3 15" />
                          <line x1="21" x2="14" y1="3" y2="10" />
                          <line x1="3" x2="10" y1="21" y2="14" />
                        </svg>
                      </button>

                      {/* 选中态 — 左下角圆点 + 微妙高亮 */}
                      <div
                        className={`absolute top-2.5 left-2.5 flex h-[22px] w-[22px] items-center justify-center rounded-full transition-all duration-200 ${
                          video.selected
                            ? "scale-100 bg-white text-primary shadow-sm"
                            : "scale-90 bg-black/10 text-white/80 opacity-0 backdrop-blur-sm group-hover:scale-100 group-hover:opacity-100 dark:bg-white/10"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggle(video.url)
                        }}
                      >
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          {video.selected ? (
                            <polyline points="20 6 9 17 4 12" />
                          ) : (
                            <>
                              <line x1="12" x2="12" y1="5" y2="19" />
                              <line x1="5" x2="19" y1="12" y2="12" />
                            </>
                          )}
                        </svg>
                      </div>
                    </div>

                    {/* 底部信息 */}
                    <div className="flex items-center gap-1.5 border-t border-border/40 px-2.5 py-1.5">
                      <span
                        className={`inline-flex shrink-0 items-center rounded px-1 py-px text-[9px] font-semibold tracking-wide uppercase ${
                          video.type === "video"
                            ? "bg-blue-500/8 text-blue-500 dark:text-blue-400"
                            : "bg-emerald-500/8 text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {video.type === "video"
                          ? "MP4"
                          : video.name.split(".").pop()?.toUpperCase() || "IMG"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
                        {video.name}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* 下载按钮 */}
              <Button
                onClick={handleDownload}
                disabled={selectedCount === 0 || downloading}
                className="w-full gap-2 rounded-xl"
                size="lg"
              >
                {downloading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    正在打包下载...
                  </>
                ) : (
                  <>
                    <IconDownload className="h-4 w-4" />
                    下载选中文件
                    {selectedCount > 0 && (
                      <span className="ml-1 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs font-medium">
                        {selectedCount}
                      </span>
                    )}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      {/* ── 预览 Dialog ──────────────────────────────────────────────── */}
      <Dialog open={!!previewFile} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="gap-0 overflow-hidden border-0 bg-card p-0 shadow-2xl sm:max-w-5xl"
          showCloseButton={false}
        >
          {/* 顶栏 */}
          <div className="flex items-center justify-between border-b border-border/50 bg-card/80 px-4 py-2.5 backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                  previewFile?.type === "video"
                    ? "bg-blue-500/10 text-blue-500"
                    : "bg-emerald-500/10 text-emerald-500"
                }`}
              >
                {previewFile?.type === "video" ? (
                  <IconVideo className="h-3 w-3" />
                ) : (
                  <IconImage className="h-3 w-3" />
                )}
              </span>
              <span className="truncate text-xs font-medium text-foreground/80">
                {previewFile?.name}
              </span>
            </div>
            <DialogClose
              render={
                <button className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground" />
              }
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
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </DialogClose>
          </div>

          {/* 媒体内容 */}
          <div className="flex items-center justify-center bg-black/[0.03] dark:bg-white/[0.03]">
            {previewUrl ? (
              previewFile?.type === "video" ? (
                <video
                  src={previewUrl}
                  controls
                  autoPlay
                  className="max-h-[80vh] w-full object-contain"
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={previewFile?.name}
                  className="max-h-[80vh] w-full object-contain"
                />
              )
            ) : (
              <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground/50">
                {previewFile?.type === "video" ? (
                  <IconVideo className="h-8 w-8" />
                ) : (
                  <IconImage className="h-8 w-8" />
                )}
                <span className="text-xs">无法加载</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
