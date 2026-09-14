"use client"

import { useState, useRef, useCallback } from "react"
import type { MediaFile } from "@/lib/types"
import { IconVideo } from "@/components/icons"

/**
 * 从视频 URL 抽取一帧作为缩略图。
 *
 * 隐藏一个 <video> 元素，加载元数据后 seek 到 0.5s，用 canvas 截取画面。
 * Shopify CDN 视频支持 Range 请求，浏览器只下载 seek 附近的几 KB 数据，
 * 不会把整个视频拉下来。
 */
function VideoThumbnail({ src, name }: { src: string; name: string }) {
  const [thumb, setThumb] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    try {
      const canvas = document.createElement("canvas")
      canvas.width = video.videoWidth || 400
      canvas.height = video.videoHeight || 300
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      setThumb(canvas.toDataURL("image/jpeg", 0.6))
    } catch {
      setFailed(true)
    }
  }, [])

  if (failed || !src) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-blue-500/[0.04] to-violet-500/[0.04]">
        <IconVideo className="h-10 w-10 text-blue-400/25" />
        <span className="text-[10px] text-muted-foreground/40">video</span>
      </div>
    )
  }

  if (thumb) {
    return (
      <img
        src={thumb}
        alt={name}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />
    )
  }

  return (
    <>
      {/* 加载中占位 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
      </div>
      <video
        ref={videoRef}
        src={src}
        preload="metadata"
        muted
        playsInline
        crossOrigin="anonymous"
        onLoadedData={() => {
          const v = videoRef.current
          if (v) {
            v.currentTime = Math.min(0.5, v.duration || 0.5)
          }
        }}
        onSeeked={capture}
        onError={() => setFailed(true)}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />
    </>
  )
}

export function MediaCard({
  file,
  onToggle,
  onPreview,
}: {
  file: MediaFile
  onToggle: () => void
  onPreview: () => void
}) {
  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-xl border border-border/60 bg-card transition-all duration-200 hover:border-border hover:shadow-lg hover:shadow-black/5"
      onClick={onToggle}
    >
      {/* 缩略图 */}
      <div className="relative aspect-square overflow-hidden bg-muted/30">
        {file.type === "image" ? (
          file.resolvedUrl ? (
            <img
              src={
                file.resolvedUrl.includes("cdn.shopify.com")
                  ? file.resolvedUrl +
                    (file.resolvedUrl.includes("?") ? "&" : "?") +
                    "width=400"
                  : file.resolvedUrl
              }
              alt={file.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            </div>
          )
        ) : file.resolvedUrl ? (
          <VideoThumbnail src={file.resolvedUrl} name={file.name} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          </div>
        )}

        {/* hover 底部渐变遮罩 + 预览按钮 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        <button
          type="button"
          className="absolute right-2 bottom-2 flex h-5 w-5 items-center justify-center rounded-full bg-white/15 text-white opacity-0 backdrop-blur-md transition-all duration-200 group-hover:opacity-100 hover:scale-110 hover:bg-white/25"
          onClick={(e) => {
            e.stopPropagation()
            onPreview()
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
            file.selected
              ? "scale-100 bg-white text-primary shadow-sm"
              : "scale-90 bg-black/10 text-white/80 opacity-0 backdrop-blur-sm group-hover:scale-100 group-hover:opacity-100 dark:bg-white/10"
          }`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
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
            {file.selected ? (
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
            file.type === "video"
              ? "bg-blue-500/8 text-blue-500 dark:text-blue-400"
              : "bg-emerald-500/8 text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {file.type === "video"
            ? "MP4"
            : file.name.split(".").pop()?.toUpperCase() || "IMG"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
          {file.name}
        </span>
      </div>
    </div>
  )
}
