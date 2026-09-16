"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { parseMediaUrls, parseSectionRefs } from "@/lib/parse"
import JSZip from "jszip"
import {
  IconVideo,
  IconImage,
  IconDownload,
  IconCheck,
  IconChevronDown,
} from "@/components/icons"
import { Badge } from "@/components/ui/badge"
import { MediaCard } from "@/components/media-card"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox"
import { PreviewDialog } from "@/components/preview-dialog"
import { CodeDialog } from "@/components/code-dialog"

// ── 主页面 ──────────────────────────────────────────────────────────────

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
  const [videos, setVideos] = useState<MediaFile[]>([])
  const [error, setError] = useState("")
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [mounted, setMounted] = useState(false)
  const [configExpanded, setConfigExpanded] = useState(true)

  // 预览状态
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // 主题 / 模板选择
  const [themes, setThemes] = useState<
    { id: number; name: string; role: string; updatedAt: string }[]
  >([])
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null)
  const [templateKeys, setTemplateKeys] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loadingThemes, setLoadingThemes] = useState(false)
  const [loadingTemplates, setLoadingTemplates] = useState(false)

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
  const [sections, setSections] = useState<string[]>([])
  const [sectionsExpanded, setSectionsExpanded] = useState(false)

  // section 代码查看
  const [viewingSection, setViewingSection] = useState<string | null>(null)
  const [sectionCode, setSectionCode] = useState<string | null>(null)

  // 模板原始 JSON
  const [templateJson, setTemplateJson] = useState<string | null>(null)
  const [templateJsonExpanded, setTemplateJsonExpanded] = useState(false)
  const [jsonCopied, setJsonCopied] = useState(false)

  const handleParse = useCallback(
    async (content: string) => {
      setError("")
      try {
        const parsed = parseMediaUrls(content)
        setSections(parseSectionRefs(content))

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
    [storeDomain, accessToken],
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

  const sortedThemes = useMemo(
    () =>
      [...themes].sort((a, b) => {
        if (a.role === "main" && b.role !== "main") return -1
        if (a.role !== "main" && b.role === "main") return 1
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
      }),
    [themes],
  )

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

    const ac = new AbortController()
    abortRef.current = ac
    const { signal } = ac

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
        signal,
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
          const res = await fetch(url, { signal })
          if (!res.ok) throw new Error(`${res.status}`)
          const blob = await res.blob()
          triggerSave(blob, file.name)
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return
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
          if (signal.aborted) return
          const file = selected[i]
          setDownloadProgress({
            current: i + 1,
            total: selected.length,
          })
          const url = file.resolvedUrl || file.url
          try {
            const res = await fetch(url, { signal })
            if (!res.ok) {
              errors.push(`${file.name}: HTTP ${res.status}`)
              continue
            }
            const buf = await res.arrayBuffer()
            zip.file(file.name, buf)
          } catch (fetchErr) {
            if (
              fetchErr instanceof DOMException &&
              fetchErr.name === "AbortError"
            )
              return
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
      if (err instanceof DOMException && err.name === "AbortError") return
      setError(err instanceof Error ? err.message : "下载失败")
    } finally {
      abortRef.current = null
      setDownloading(false)
      setDownloadProgress(null)
    }
  }, [videos, storeDomain, accessToken])

  const handleCancelDownload = useCallback(() => {
    abortRef.current?.abort()
  }, [])

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
    // previewUrl 保留不立即清空——弹窗关闭动画期间媒体 src 需要还在，
    // 否则素材会先消失、弹窗再关。真正的清空由 PreviewDialog 的
    // onOpenChange(false) 回调触发。
  }, [])

  // ── Section 代码查看 ───────────────────────────────────────────────
  const handleViewSection = useCallback(
    async (key: string) => {
      if (!selectedThemeId) return
      setViewingSection(key)
      setSectionCode(null)
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
        if (!res.ok) throw new Error(data.error || "获取 Section 内容失败")
        setSectionCode(data.content ?? "")
      } catch (err) {
        setSectionCode(`// 加载失败: ${err instanceof Error ? err.message : "未知错误"}`)
      }
    },
    [selectedThemeId, storeDomain, accessToken],
  )

  const closeCodeDialog = useCallback(() => {
    setViewingSection(null)
    // sectionCode 保留，关闭动画期间内容仍然可见
  }, [])

  // ── 主题 / 模板获取 ─────────────────────────────────────────────────

  const fetchTemplates = useCallback(
    async (themeId: number) => {
      setLoadingTemplates(true)
      setError("")
      setTemplateKeys([])
      setSelectedKey(null)
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
        setLoadingTemplates(false)
      }
    },
    [storeDomain, accessToken],
  )

  const fetchThemes = useCallback(async () => {
    setLoadingThemes(true)
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
      const list: {
        id: number
        name: string
        role: string
        updatedAt: string
      }[] = (data.themes ?? []).filter(
        (t: { role: string }) => t.role !== "development",
      )
      setThemes(list)
      // 自动选中 live 主题
      const live = list.find((t) => t.role === "main")
      if (live) {
        setSelectedThemeId(live.id)
        fetchTemplates(live.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取主题失败")
    } finally {
      setLoadingThemes(false)
    }
  }, [storeDomain, accessToken, fetchTemplates])

  /** 选择模板后自动获取内容并解析 */
  const handleSelectTemplate = useCallback(
    async (key: string | null) => {
      if (!key) return
      setSelectedKey(key)
      if (!selectedThemeId) return
      setVideos([])
      setResolving(true)
      setError("")
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
        setTemplateJson(content)
        await handleParse(content)
      } catch (err) {
        setError(err instanceof Error ? err.message : "获取模板内容失败")
      } finally {
        setResolving(false)
      }
    },
    [selectedThemeId, storeDomain, accessToken, handleParse],
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
      fetchTemplates(themeId)
    },
    [fetchTemplates],
  )

  // ── Loading skeleton ────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

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
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold bg-foreground text-background`}
              >
               1
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

       

        {/* ── Step 2: 选择主题 & 模板 ─────────────────────────────────── */}
        <Card className="border-border/50 shadow-sm">
          <CardContent className="space-y-4 px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                2
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">获取模板素材</p>
                <p className="text-xs text-muted-foreground">
                  {resolving
                    ? "正在解析素材..."
                    : videos.length > 0
                      ? `已解析 ${videos.length} 个文件`
                      : "选择主题和模板，自动解析素材"}
                </p>
              </div>
              {(loadingThemes || loadingTemplates || resolving) && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              )}
            </div>

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
                        <div className="w-full flex  gap-2">
                          <span>{theme.name}</span>
                          <Badge
                            variant="secondary"
                            className={
                              theme.role === "main"
                                ? "bg-[#affebf] text-black dark:text-emerald-400 text-[10px]"
                                : "text-[#666666] text-[10px]"
                            }
                          >
                            {theme.role === "main" ? "Live" : theme.role}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : isConfigured ? (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
                  未找到主题
                </div>
              ) : null}
            </div>

            {/* 模板选择（带搜索） */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">模板</Label>
              {loadingTemplates ? (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
                  加载模板列表...
                </div>
              ) : templateKeys.length > 0 ? (
                <Combobox
                  value={selectedKey}
                  onValueChange={(v) => handleSelectTemplate(v as string)}
                  items={templateKeys}
                  itemToStringLabel={(key) => templateLabel(key)}
                >
                  <ComboboxInput
                    placeholder="搜索模板..."
                    className="h-9"
                  />
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
              ) : selectedThemeId ? (
                <div className="flex h-9 items-center rounded-md border border-input bg-muted/30 px-3 text-xs text-muted-foreground">
                  未找到模板
                </div>
              ) : null}
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
         {/* ── 模板代码信息（可折叠） ── */}
        {(templateJson || sections.length > 0) && (
          <div className="space-y-3 rounded-xl border border-border/40 bg-muted/30 px-4 py-3">
            {/* 模板 JSON */}
            {templateJson && (
              <div className="space-y-2">
                <button
                  onClick={() => setTemplateJsonExpanded((p) => !p)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-background/50"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center">
                      <svg
                        className="h-4 w-4 text-foreground/40"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      模板 JSON
                    </span>
                  </div>
                  <IconChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform ${
                      templateJsonExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {templateJsonExpanded && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between pl-2">
                      <span className="text-xs text-muted-foreground/70">
                        {selectedKey?.replace(/^templates\//, "")}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground/70"
                          onClick={() => {
                            const blob = new Blob([templateJson], {
                              type: "application/json",
                            })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement("a")
                            a.href = url
                            a.download =
                              selectedKey?.replace(
                                /^templates\//,
                                "",
                              ) || "template.json"
                            document.body.appendChild(a)
                            a.click()
                            URL.revokeObjectURL(url)
                            document.body.removeChild(a)
                          }}
                        >
                          下载
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground/70"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                templateJson,
                              )
                              setJsonCopied(true)
                              setTimeout(
                                () => setJsonCopied(false),
                                2000,
                              )
                            } catch {
                              // ignore
                            }
                          }}
                        >
                          {jsonCopied ? "✓ 已复制" : "复制"}
                        </Button>
                      </div>
                    </div>
                    <pre className="max-h-72 overflow-auto rounded-lg bg-background/60 p-3 text-[12px] leading-relaxed">
                      <code className="font-mono text-foreground/50">
                        {templateJson}
                      </code>
                    </pre>
                  </div>
                )}
              </div>
            )}

            {templateJson && sections.length > 0 && (
              <div className="mx-2 h-px bg-border/40" />
            )}

            {/* Section 列表 */}
            {sections.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setSectionsExpanded((p) => !p)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-background/50"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center">
                      <svg
                        className="h-4 w-4 text-violet-500/60"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      引用的 Section
                    </span>
                    <span className="rounded-full bg-violet-500/8 px-1.5 py-0.5 text-[11px] font-medium text-violet-500/70">
                      {sections.length}
                    </span>
                  </div>
                  <IconChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform ${
                      sectionsExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {sectionsExpanded && (
                  <div className="grid gap-1 pl-2">
                    {sections.map((key) => (
                      <button
                        key={key}
                        onClick={() => handleViewSection(key)}
                        className="group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-background/50"
                      >
                        <span className="text-muted-foreground/30 transition-colors group-hover:text-violet-500/60">
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground/70 transition-colors group-hover:text-foreground">
                          {key}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── 素材列表 ───────────────────────────────────────────────── */}
        {(videos.length > 0 || resolving) && (
          <Card className="border-border/50 shadow-sm">
            <CardContent className="space-y-5 px-6 py-5">
              {resolving && videos.length === 0 ? (
                <div className="space-y-3 py-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                      3
                    </span>
                    <span className="text-sm font-medium text-muted-foreground">
                      正在解析素材...
                    </span>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                  </div>
                  <div className="space-y-2 pl-10">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-10 animate-pulse rounded-md bg-muted/50"
                      />
                    ))}
                  </div>
                </div>
              ) : (
              <>
              {/* ── 顶栏：文件计数 + 操作按钮 ── */}
              <div className="flex flex-wrap  items-center justify-between gap-3">
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
                    {downloading ? "下载中" : "下载"}
                    {!downloading && selectedCount > 0 && (
                      <span className="rounded-full bg-primary-foreground/20 px-1.5 py-px text-[10px] font-medium">
                        {selectedCount}
                      </span>
                    )}
                  </Button>
                  {downloading && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 rounded-lg text-xs"
                      onClick={handleCancelDownload}
                    >
                      取消
                    </Button>
                  )}
                </div>
              </div>

              {/* ── 下载进度条 ── */}
              {downloadProgress && (
                <Progress
                  value={
                    (downloadProgress.current / downloadProgress.total) * 100
                  }
                  className="gap-2"
                >
                  <ProgressLabel className="text-xs">
                    正在下载
                  </ProgressLabel>
                  <ProgressValue className="text-xs" />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ({downloadProgress.current}/{downloadProgress.total})
                  </span>
                </Progress>
              )}

              {/* ── 素材文件 ── */}
              <div className="space-y-5">
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
                            const allSelected = videoList.every(
                              (v) => v.selected,
                            )
                            handleToggleType("video", !allSelected)
                          }}
                        >
                          {videoList.every((v) => v.selected)
                            ? "取消全选"
                            : "全选"}
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
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
                            const allSelected = imageList.every(
                              (v) => v.selected,
                            )
                            handleToggleType("image", !allSelected)
                          }}
                        >
                          {imageList.every((v) => v.selected)
                            ? "取消全选"
                            : "全选"}
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
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
                </div>
              </>
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

      {/* ── Section 代码 Dialog ──────────────────────────────────────── */}
      <CodeDialog
        sectionKey={viewingSection}
        code={sectionCode}
        onClose={closeCodeDialog}
      />

    </div>
  )
}
