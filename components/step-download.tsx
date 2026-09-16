"use client"

import { useState, useCallback, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { type MediaFile } from "@/lib/types"
import { IconVideo, IconImage, IconDownload } from "@/components/icons"
import { MediaCard } from "@/components/media-card"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { triggerSave } from "@/lib/template"
import JSZip from "jszip"

interface StepDownloadProps {
  videos: MediaFile[]
  resolving: boolean
  storeDomain: string
  accessToken: string
  targetDomain: string
  targetToken: string
  onVideosChange: (videos: MediaFile[]) => void
  onPreview: (file: MediaFile) => void
  onError: (msg: string) => void
  onPushImages: (images: MediaFile[]) => void
}

export function StepDownload({
  videos,
  resolving,
  storeDomain,
  accessToken,
  targetDomain,
  targetToken,
  onVideosChange,
  onPreview,
  onError,
  onPushImages,
}: StepDownloadProps) {
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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

  const handleToggle = useCallback(
    (url: string) => {
      onVideosChange(
        videos.map((v) =>
          v.url === url ? { ...v, selected: !v.selected } : v,
        ),
      )
    },
    [videos, onVideosChange],
  )

  const handleSelectAll = useCallback(() => {
    onVideosChange(videos.map((v) => ({ ...v, selected: true })))
  }, [videos, onVideosChange])

  const handleDeselectAll = useCallback(() => {
    onVideosChange(videos.map((v) => ({ ...v, selected: false })))
  }, [videos, onVideosChange])

  const handleToggleType = useCallback(
    (type: "video" | "image", select: boolean) => {
      onVideosChange(
        videos.map((v) => (v.type === type ? { ...v, selected: select } : v)),
      )
    },
    [videos, onVideosChange],
  )

  const handleCancelDownload = useCallback(() => {
    abortRef.current?.abort()
    setDownloading(false)
    setDownloadProgress(null)
  }, [])

  const handleDownload = useCallback(async () => {
    const selected = videos.filter((v) => v.selected)
    if (selected.length === 0) return
    if (!storeDomain || !accessToken) {
      onError("请先填写店铺域名和 API Token")
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
    onError("")
    try {
      if (selected.length === 1) {
        const file = selected[0]
        const url = file.resolvedUrl || file.url
        try {
          const res = await fetch(url, { signal })
          if (!res.ok) throw new Error(`${res.status}`)
          const blob = await res.blob()
          triggerSave(blob, file.name)
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return
          await serverFallback()
        }
      } else {
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
            clientFailed = true
            break
          }
        }

        if (clientFailed) {
          await serverFallback()
        } else if (errors.length > 0) {
          onError(errors.join("\n"))
        } else {
          const blob = await zip.generateAsync({ type: "blob" })
          triggerSave(blob, `shopify-assets-${Date.now()}.zip`)
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      onError(err instanceof Error ? err.message : "下载失败")
    } finally {
      setDownloading(false)
      setDownloadProgress(null)
    }
  }, [videos, storeDomain, accessToken, onError])

  if (videos.length === 0 && !resolving) return null

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="space-y-5 px-6 py-5">
        {resolving && videos.length === 0 ? (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                4
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
            {/* 顶栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                  4
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

            {/* 下载进度条 */}
            {downloadProgress && (
              <Progress
                value={
                  (downloadProgress.current / downloadProgress.total) * 100
                }
                className="gap-2"
              >
                <ProgressLabel className="text-xs">正在下载</ProgressLabel>
                <ProgressValue className="text-xs" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  ({downloadProgress.current}/{downloadProgress.total})
                </span>
              </Progress>
            )}

            {/* 素材文件 */}
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
                        onPreview={() => onPreview(file)}
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
                    <div className="flex items-center gap-1">
                    {imageList.some((v) => v.selected) &&
                      targetDomain &&
                      targetToken && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 gap-1 text-[11px]"
                          onClick={() => {
                            const selected = imageList.filter(
                              (v) => v.selected,
                            )
                            if (selected.length > 0) onPushImages(selected)
                          }}
                        >
                          <svg
                            className="h-3 w-3"
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
                          推送到目标站点
                        </Button>
                      )}
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
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
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
          </>
        )}
      </CardContent>
    </Card>
  )
}
