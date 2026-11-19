"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import type { MediaFile } from "@/lib/types"
import { IconVideo, IconImage } from "@/components/icons"
import { CopyUrlButton } from "@/components/copy-url-button"
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog"
import { formatBytes } from "@/lib/utils"

export function PreviewDialog({
  file,
  previewUrl,
  position,
  onPrev,
  onNext,
  onClose,
}: {
  file: MediaFile | null
  previewUrl: string | null
  /** 当前素材在可预览列表中的位置 */
  position?: { index: number; total: number } | null
  onPrev?: () => void
  onNext?: () => void
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [displayUrl, setDisplayUrl] = useState<string | null>(null)
  const displayUrlRef = useRef<string | null>(null)
  const prevFileRef = useRef<MediaFile | null>(null)

  // 新文件打开时重置 displayUrl；关闭时不动（动画期间保持媒体可见）
  useEffect(() => {
    if (file && file !== prevFileRef.current) {
      prevFileRef.current = file
      displayUrlRef.current = previewUrl
      setDisplayUrl(previewUrl)
      setLoaded(false)
    }
    if (!file) {
      prevFileRef.current = null
    }
  }, [file, previewUrl])

  // 左右方向键切换上一个 / 下一个；视频获得焦点时把方向键留给播放器
  useEffect(() => {
    if (!file) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.tagName === "VIDEO" ||
          target.isContentEditable)
      ) {
        return
      }

      if (event.key === "ArrowLeft" && onPrev) {
        event.preventDefault()
        onPrev()
      } else if (event.key === "ArrowRight" && onNext) {
        event.preventDefault()
        onNext()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [file, onPrev, onNext])

  // 只通知父组件，不碰 displayUrl——动画期间媒体 src 保持有效
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose()
    },
    [onClose]
  )

  const handleMediaReady = useCallback(() => {
    if (displayUrlRef.current === displayUrl) setLoaded(true)
  }, [displayUrl])

  const meta = file
    ? [
        file.width && file.height ? `${file.width}×${file.height}` : "",
        file.size ? formatBytes(file.size) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  return (
    <Dialog open={!!file} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden border-0 bg-card p-0 shadow-2xl sm:max-w-5xl"
        showCloseButton={false}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-border/50 bg-card/80 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                file?.type === "video"
                  ? "bg-blue-500/10 text-blue-500"
                  : "bg-emerald-500/10 text-emerald-500"
              }`}
            >
              {file?.type === "video" ? (
                <IconVideo className="h-3 w-3" />
              ) : (
                <IconImage className="h-3 w-3" />
              )}
            </span>
            <span className="truncate text-xs font-medium text-foreground/80">
              {file?.name}
            </span>
            {meta && (
              <span className="shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                {meta}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {position && position.total > 1 && (
              <span className="text-[11px] text-muted-foreground/60 tabular-nums">
                {position.index}/{position.total}
              </span>
            )}
            {previewUrl && (
              <CopyUrlButton url={previewUrl} className="h-6 w-6" />
            )}
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
        </div>

        {/* 媒体内容 */}
        <div className="relative flex min-h-[200px] items-center justify-center bg-black/[0.03] dark:bg-white/[0.03]">
          {/* 加载骨架 */}
          {!loaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/40" />
              </div>
            </div>
          )}

          {/* 上一个 / 下一个（也可用左右方向键） */}
          {position && position.total > 1 && onPrev && (
            <button
              type="button"
              onClick={onPrev}
              aria-label="上一个素材"
              className="absolute top-1/2 left-3 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
          {position && position.total > 1 && onNext && (
            <button
              type="button"
              onClick={onNext}
              aria-label="下一个素材"
              className="absolute top-1/2 right-3 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}

          {/* 媒体元素始终用 displayUrl，关闭动画期间 src 保持有效 */}
          {displayUrl ? (
            file?.type === "video" ? (
              <video
                src={displayUrl}
                controls
                autoPlay
                onCanPlay={handleMediaReady}
                className={`max-h-[80vh] w-full object-contain transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
              />
            ) : (
              <img
                src={displayUrl}
                alt={file?.name}
                onLoad={handleMediaReady}
                className={`max-h-[80vh] w-full object-contain transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground/50">
              {file?.type === "video" ? (
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
  )
}
