"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import Link from "next/link"
import JSZip from "jszip"
import { Button } from "@/components/ui/button"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { type MediaFile } from "@/lib/types"
import { IconVideo, IconImage, IconDownload } from "@/components/icons"
import { MediaCard } from "@/components/media-card"
import { StepHeader } from "@/components/step-header"
import { mapWithConcurrency } from "@/lib/concurrency"
import {
  alignExtension,
  filenameFromContentDisposition,
  safeFileName,
  uniqueFileName,
} from "@/lib/filename"
import { readResponseBody } from "@/lib/stream"
import { triggerSave } from "@/lib/template"
import { cn, formatBytes } from "@/lib/utils"

interface StepDownloadProps {
  videos: MediaFile[]
  resolving: boolean
  resolveProgress: { done: number; total: number } | null
  failedCount: number
  storeDomain: string
  accessToken: string
  targetDomain: string
  targetToken: string
  onRetryFailed: () => void
  onVideosChange: (videos: MediaFile[]) => void
  onPreview: (file: MediaFile) => void
  onError: (msg: string) => void
  onPushFiles: (files: MediaFile[]) => void
}

/** ZIP 下载并发数。每个文件都整段进内存，别开太高。 */
const ZIP_CONCURRENCY = 3

type DownloadOutcome =
  | { status: "ok"; name: string; buffer: ArrayBuffer }
  | { status: "error"; error: string }
  | { status: "network" }
  | null

function UploadIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 17V3" />
      <path d="m6 11 6-6 6 6" />
      <path d="M19 21H5" />
    </svg>
  )
}

export function StepDownload({
  videos,
  resolving,
  resolveProgress,
  failedCount,
  storeDomain,
  accessToken,
  targetDomain,
  targetToken,
  onRetryFailed,
  onVideosChange,
  onPreview,
  onError,
  onPushFiles,
}: StepDownloadProps) {
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [downloadBytes, setDownloadBytes] = useState(0)
  const [typeFilter, setTypeFilter] = useState<"all" | "video" | "image">("all")
  const abortRef = useRef<AbortController | null>(null)

  const targetConfigured = !!(targetDomain && targetToken)

  // 换模板时素材会被清空，类型筛选复位；setState 走微任务避免 lint
  useEffect(() => {
    if (videos.length > 0) return
    Promise.resolve().then(() => setTypeFilter("all"))
  }, [videos.length])

  const filteredVideos = useMemo(
    () =>
      typeFilter === "all"
        ? videos
        : videos.filter((v) => v.type === typeFilter),
    [videos, typeFilter]
  )

  const videoList = useMemo(
    () => filteredVideos.filter((v) => v.type === "video"),
    [filteredVideos]
  )
  const imageList = useMemo(
    () => filteredVideos.filter((v) => v.type === "image"),
    [filteredVideos]
  )

  const selectableVideos = useMemo(
    () => filteredVideos.filter((v) => !!v.resolvedUrl),
    [filteredVideos]
  )
  const selectableVideoList = useMemo(
    () => videoList.filter((v) => !!v.resolvedUrl),
    [videoList]
  )
  const selectableImageList = useMemo(
    () => imageList.filter((v) => !!v.resolvedUrl),
    [imageList]
  )

  const allSelectableSelected =
    selectableVideos.length > 0 && selectableVideos.every((v) => v.selected)
  const allVideosSelected =
    selectableVideoList.length > 0 &&
    selectableVideoList.every((v) => v.selected)
  const allImagesSelected =
    selectableImageList.length > 0 &&
    selectableImageList.every((v) => v.selected)

  const selectedVideos = filteredVideos.filter((v) => v.selected)
  const selectedCount = selectedVideos.length
  // 推送必须走已解析的 CDN 地址，别把 shopify:// 原路径发过去
  const pushableSelected = selectedVideos.filter((v) => !!v.resolvedUrl)
  const videoCount = videos.filter((v) => v.type === "video").length
  const imageCount = videos.filter((v) => v.type === "image").length

  const handleToggle = useCallback(
    (url: string) => {
      onVideosChange(
        videos.map((v) => (v.url === url ? { ...v, selected: !v.selected } : v))
      )
    },
    [videos, onVideosChange]
  )

  const handleSelectAll = useCallback(() => {
    const visible = new Set(filteredVideos.map((v) => v.url))

    if (allSelectableSelected) {
      onVideosChange(
        videos.map((v) => (visible.has(v.url) ? { ...v, selected: false } : v))
      )
      return
    }

    onVideosChange(
      videos.map((v) =>
        visible.has(v.url) && v.resolvedUrl ? { ...v, selected: true } : v
      )
    )
  }, [allSelectableSelected, videos, filteredVideos, onVideosChange])

  const handleToggleType = useCallback(
    (type: "video" | "image", select: boolean) => {
      onVideosChange(
        videos.map((v) => {
          if (v.type !== type) return v
          if (select && !v.resolvedUrl) return v
          return { ...v, selected: select }
        })
      )
    },
    [videos, onVideosChange]
  )

  const handleCancelDownload = useCallback(() => {
    abortRef.current?.abort()
    setDownloading(false)
    setDownloadProgress(null)
    setDownloadBytes(0)
  }, [])

  const handleDownload = useCallback(async () => {
    const selected = filteredVideos.filter((v) => v.selected)
    if (selected.length === 0) return
    if (!storeDomain || !accessToken) {
      onError("请先在店铺配置中设置当前源店铺")
      return
    }

    const ac = new AbortController()
    abortRef.current = ac
    const { signal } = ac

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
          `${data.error}${errorDetails ? ":\n" + errorDetails : ""}`
        )
      }
      const blob = await response.blob()

      if (selected.length === 1) {
        const file = selected[0]
        const url = file.resolvedUrl || file.url
        const name =
          filenameFromContentDisposition(
            response.headers.get("content-disposition")
          ) || alignExtension(safeFileName(file.name), url)
        triggerSave(blob, name)
      } else {
        triggerSave(blob, `shopify-assets-${Date.now()}.zip`)
      }
    }

    setDownloading(true)
    setDownloadProgress(null)
    setDownloadBytes(0)
    onError("")

    try {
      if (selected.length === 1) {
        const file = selected[0]
        const url = file.resolvedUrl || file.url
        const name = alignExtension(safeFileName(file.name), url)
        try {
          const res = await fetch(url, { signal })
          if (!res.ok) throw new Error(`${res.status}`)
          const blob = await res.blob()
          triggerSave(blob, name)
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return
          await serverFallback()
        }
      } else {
        // 先按顺序分配唯一文件名，再并发下载 —— 否则重名后缀会跟着
        // 下载完成顺序变化，每次打包出来都不一样。
        const used = new Set<string>()
        const jobs = selected.map((file) => {
          const url = file.resolvedUrl || file.url
          return {
            url,
            name: uniqueFileName(
              alignExtension(safeFileName(file.name), url),
              used
            ),
          }
        })

        let completed = 0
        let downloadedBytes = 0
        let lastBytesAt = 0

        setDownloadProgress({ current: 0, total: jobs.length })

        const outcomes = await mapWithConcurrency(
          jobs,
          ZIP_CONCURRENCY,
          async (job): Promise<DownloadOutcome> => {
            if (signal.aborted) return null

            let lastReceived = 0
            try {
              const res = await fetch(job.url, { signal })
              if (!res.ok) {
                return {
                  status: "error",
                  error: `${job.name}: HTTP ${res.status}`,
                }
              }

              const buffer = await readResponseBody(res, (received) => {
                downloadedBytes += received - lastReceived
                lastReceived = received

                const now = Date.now()
                if (now - lastBytesAt >= 200) {
                  lastBytesAt = now
                  setDownloadBytes(downloadedBytes)
                }
              })

              return { status: "ok", name: job.name, buffer }
            } catch (err) {
              if (err instanceof DOMException && err.name === "AbortError") {
                return null
              }
              // 网络 / CORS 失败：整个批次退回服务端下载
              return { status: "network" }
            } finally {
              if (!signal.aborted) {
                completed++
                setDownloadProgress({
                  current: completed,
                  total: jobs.length,
                })
                setDownloadBytes(downloadedBytes)
              }
            }
          }
        )

        if (signal.aborted) return

        if (outcomes.some((outcome) => outcome?.status === "network")) {
          await serverFallback()
          return
        }

        const zip = new JSZip()
        const errors: string[] = []
        let added = 0

        for (const outcome of outcomes) {
          if (!outcome) continue
          if (outcome.status === "network") continue
          if (outcome.status === "error") {
            errors.push(outcome.error)
            continue
          }
          zip.file(outcome.name, outcome.buffer)
          added++
        }

        if (added === 0) {
          onError(errors.join("\n") || "下载失败")
          return
        }

        // 有成功项就照常打包，失败的写进明细，别把成功的也一起丢掉
        if (errors.length > 0) {
          zip.file(
            uniqueFileName("下载失败记录.txt", used),
            errors.join("\n\n")
          )
        }

        const blob = await zip.generateAsync({ type: "blob" })
        triggerSave(blob, `shopify-assets-${Date.now()}.zip`)
        if (errors.length > 0) onError(errors.join("\n"))
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      onError(err instanceof Error ? err.message : "下载失败")
    } finally {
      setDownloading(false)
      setDownloadProgress(null)
      setDownloadBytes(0)
    }
  }, [filteredVideos, storeDomain, accessToken, onError])

  if (videos.length === 0 && !resolving) return null

  return (
    <section className="space-y-6">
      {resolving && videos.length === 0 ? (
        <>
          <StepHeader
            step={2}
            title="素材列表"
            subtitle={
              resolveProgress
                ? `正在解析素材 ${resolveProgress.done}/${resolveProgress.total}`
                : "正在解析素材..."
            }
            actions={
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            }
          />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-muted/40"
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <StepHeader
            step={2}
            title="素材列表"
            subtitle={
              resolving ? (
                <>
                  正在解析素材
                  {resolveProgress &&
                    ` ${resolveProgress.done}/${resolveProgress.total}`}
                </>
              ) : (
                <div className="mt-2 inline-flex items-center gap-2 rounded-xl bg-muted/60 p-1">
                  {[
                    {
                      key: "all" as const,
                      label: `全部 ${videos.length}`,
                      count: videos.length,
                    },
                    {
                      key: "video" as const,
                      label: `视频 ${videoCount}`,
                      count: videoCount,
                    },
                    {
                      key: "image" as const,
                      label: `图片 ${imageCount}`,
                      count: imageCount,
                    },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      disabled={item.key !== "all" && item.count === 0}
                      onClick={() => setTypeFilter(item.key)}
                      className={cn(
                        "h-7 rounded-lg px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        typeFilter === item.key
                          ? "bg-background text-foreground shadow-sm dark:bg-muted"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )
            }
            actions={
              resolving ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              ) : failedCount > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-[11px] text-destructive"
                  onClick={onRetryFailed}
                >
                  重试失败项 ({failedCount})
                </Button>
              ) : undefined
            }
          />

          {/* 素材文件 */}
          <div className="space-y-6">
            {videoList.length > 0 && (
              <div className="space-y-4">
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
                    onClick={() =>
                      handleToggleType("video", !allVideosSelected)
                    }
                  >
                    {allVideosSelected ? "取消全选" : "全选"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {videoList.map((file) => (
                    <MediaCard
                      key={file.url}
                      file={file}
                      onToggle={() => handleToggle(file.url)}
                      onPreview={() => onPreview(file)}
                    />
                  ))}
                </div>
              </div>
            )}

            {imageList.length > 0 && (
              <div className="space-y-4">
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
                    onClick={() =>
                      handleToggleType("image", !allImagesSelected)
                    }
                  >
                    {allImagesSelected ? "取消全选" : "全选"}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {imageList.map((file) => (
                    <MediaCard
                      key={file.url}
                      file={file}
                      onToggle={() => handleToggle(file.url)}
                      onPreview={() => onPreview(file)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 底部操作栏：长列表滚动时也能直接下载/推送 */}
          <div className="sticky bottom-5 z-20 space-y-2 rounded-2xl bg-foreground/95 px-4 py-3 text-background shadow-[0_20px_50px_-12px_rgba(0,0,0,0.45)] ring-1 ring-background/10 backdrop-blur-xl">
            {downloadProgress && (
              <Progress
                value={
                  (downloadProgress.current / downloadProgress.total) * 100
                }
                className="w-full gap-1.5 [&_[data-slot=progress-indicator]]:bg-background [&_[data-slot=progress-track]]:bg-background/20"
              >
                <ProgressLabel className="text-[11px] text-background/80">
                  正在下载
                </ProgressLabel>
                <ProgressValue className="text-[11px] text-background/70" />
                <span className="text-[11px] text-background/70 tabular-nums">
                  ({downloadProgress.current}/{downloadProgress.total})
                  {downloadBytes > 0 && ` · ${formatBytes(downloadBytes)}`}
                </span>
              </Progress>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="pl-1 text-xs text-background/70">
                  已选{" "}
                  <span className="text-sm font-semibold text-background tabular-nums">
                    {selectedCount}
                  </span>
                </span>
                <span className="h-3 w-px bg-background/20" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[11px] text-background/70 hover:bg-background/10 hover:text-background"
                  onClick={handleSelectAll}
                  disabled={selectableVideos.length === 0}
                >
                  {allSelectableSelected ? "取消全选" : "全选已解析"}
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {!targetConfigured && (
                  <span className="text-[11px] text-background/70">
                    未配置目标店铺 ·{" "}
                    <Link
                      href="/config"
                      className="underline underline-offset-2 hover:text-background"
                    >
                      去配置
                    </Link>
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 rounded-lg border-background/25 bg-transparent text-xs text-background hover:bg-background/10 hover:text-background"
                  onClick={() => onPushFiles(pushableSelected)}
                  disabled={pushableSelected.length === 0 || !targetConfigured}
                  title={
                    !targetConfigured
                      ? "请先在店铺配置中设置当前目标店铺"
                      : undefined
                  }
                >
                  <UploadIcon />
                  推送选中
                  {pushableSelected.length > 0 && (
                    <span className="rounded-full bg-background/15 px-1.5 py-px text-[10px] font-medium text-background/80">
                      {pushableSelected.length}
                    </span>
                  )}
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 rounded-lg bg-background text-xs text-foreground hover:bg-background/90"
                  onClick={handleDownload}
                  disabled={selectedCount === 0 || downloading}
                >
                  {downloading ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground" />
                  ) : (
                    <IconDownload className="h-3.5 w-3.5" />
                  )}
                  {downloading ? "下载中" : "下载"}
                  {!downloading && selectedCount > 0 && (
                    <span className="rounded-full bg-foreground/10 px-1.5 py-px text-[10px] font-medium text-foreground/70">
                      {selectedCount}
                    </span>
                  )}
                </Button>
                {downloading && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 rounded-lg border-background/25 bg-transparent text-xs text-background hover:bg-background/10 hover:text-background"
                    onClick={handleCancelDownload}
                  >
                    取消
                  </Button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
