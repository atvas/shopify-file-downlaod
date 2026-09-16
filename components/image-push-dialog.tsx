"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "@/components/ui/dialog"
import { type MediaFile } from "@/lib/types"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"

interface PushResult {
  name: string
  status: "uploaded" | "skipped" | "error"
  error?: string
}

interface ImagePushDialogProps {
  open: boolean
  images: MediaFile[]
  targetDomain: string
  targetToken: string
  onClose: () => void
  onError: (msg: string) => void
}

export function ImagePushDialog({
  open,
  images,
  targetDomain,
  targetToken,
  onClose,
  onError,
}: ImagePushDialogProps) {
  const [phase, setPhase] = useState<"input" | "pushing" | "done">("input")
  const [results, setResults] = useState<PushResult[]>([])
  const [progress, setProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 重置状态
  useEffect(() => {
    if (open) {
      setPhase("input")
      setResults([])
      setProgress(null)
    }
  }, [open])

  const handlePush = useCallback(async () => {
    if (!targetDomain || !targetToken) {
      onError("请先在 API 配置中填写目标站点域名和 Token")
      return
    }
    if (images.length === 0) return

    const ac = new AbortController()
    abortRef.current = ac

    setPhase("pushing")
    setResults([])
    setProgress({ current: 0, total: images.length })
    onError("")

    try {
      const res = await fetch("/api/shopify-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDomain,
          targetToken,
          images: images.map((img) => ({
            url: img.resolvedUrl || img.url,
            name: img.name,
          })),
        }),
        signal: ac.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "推送失败")
      }
      if (!res.body) throw new Error("推送失败")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let count = 0

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const result = JSON.parse(trimmed) as PushResult
            count++
            setResults((prev) => [...prev, result])
            setProgress({ current: count, total: images.length })
          } catch {
            // skip bad lines
          }
        }
      }

      // 收尾
      const tail = buffer.trim()
      if (tail) {
        try {
          const result = JSON.parse(tail) as PushResult
          setResults((prev) => [...prev, result])
        } catch {
          // ignore
        }
      }

      setPhase("done")
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      onError(err instanceof Error ? err.message : "推送失败")
      setPhase("input")
    }
  }, [targetDomain, targetToken, images, onError])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    setPhase("input")
    setProgress(null)
  }, [])

  const handleClose = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        if (phase === "pushing") {
          abortRef.current?.abort()
        }
        onClose()
      }
    },
    [phase, onClose],
  )

  const uploaded = results.filter((r) => r.status === "uploaded").length
  const skipped = results.filter((r) => r.status === "skipped").length
  const failed = results.filter((r) => r.status === "error").length

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border-0 bg-card p-0 shadow-2xl sm:max-w-lg"
        showCloseButton={false}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-border/50 bg-card/80 px-4 py-2.5 backdrop-blur-sm">
          <span className="text-sm font-medium">
            推送图片到目标站点
          </span>
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

        {/* 内容 */}
        <div className="space-y-4 overflow-y-auto p-4">
          {phase === "input" && (
            <>
              <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  目标站点: {targetDomain}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  将推送 {images.length} 张图片，已存在的文件会自动跳过
                </p>
              </div>

              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border/30 bg-background/50 p-2">
                {images.map((img) => (
                  <div
                    key={img.url}
                    className="flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground"
                  >
                    <svg
                      className="h-3 w-3 shrink-0 text-emerald-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect
                        x="3"
                        y="3"
                        width="18"
                        height="18"
                        rx="2"
                        ry="2"
                      />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                    </svg>
                    <span className="truncate">{img.name}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <DialogClose
                  render={<Button variant="ghost" size="sm" />}
                >
                  取消
                </DialogClose>
                <Button size="sm" onClick={handlePush}>
                  开始推送
                </Button>
              </div>
            </>
          )}

          {phase === "pushing" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  正在推送...
                </span>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              </div>

              {progress && (
                <Progress
                  value={(progress.current / progress.total) * 100}
                  className="gap-2"
                >
                  <ProgressLabel className="text-xs">进度</ProgressLabel>
                  <ProgressValue className="text-xs" />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ({progress.current}/{progress.total})
                  </span>
                </Progress>
              )}

              <div className="max-h-64 space-y-1 overflow-y-auto">
                {results.map((r, i) => (
                  <div
                    key={`${r.name}-${i}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-xs"
                  >
                    {r.status === "uploaded" && (
                      <svg
                        className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {r.status === "skipped" && (
                      <svg
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
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
                    )}
                    {r.status === "error" && (
                      <svg
                        className="h-3.5 w-3.5 shrink-0 text-destructive"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" x2="12" y1="8" y2="12" />
                        <line x1="12" x2="12.01" y1="16" y2="16" />
                      </svg>
                    )}
                    <span
                      className={`truncate ${
                        r.status === "error"
                          ? "text-destructive"
                          : r.status === "skipped"
                            ? "text-muted-foreground"
                            : "text-foreground"
                      }`}
                    >
                      {r.name}
                    </span>
                    {r.status === "skipped" && (
                      <span className="text-muted-foreground/60">
                        已存在，跳过
                      </span>
                    )}
                    {r.status === "error" && r.error && (
                      <span className="truncate text-destructive/70">
                        {r.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancel}
                >
                  取消
                </Button>
              </div>
            </>
          )}

          {phase === "done" && (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
                <svg
                  className="h-5 w-5 text-emerald-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">推送完成</p>
                  <p className="text-xs text-muted-foreground">
                    {uploaded > 0 && `${uploaded} 上传`}
                    {skipped > 0 && ` · ${skipped} 跳过`}
                    {failed > 0 && ` · ${failed} 失败`}
                  </p>
                </div>
              </div>

              {failed > 0 && (
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {results
                    .filter((r) => r.status === "error")
                    .map((r, i) => (
                      <div
                        key={`err-${i}`}
                        className="flex items-center gap-2 rounded px-2 py-1 text-xs text-destructive"
                      >
                        <span className="truncate">{r.name}</span>
                        <span className="text-destructive/60">
                          {r.error}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              <div className="flex justify-end">
                <DialogClose render={<Button size="sm" />}>
                  完成
                </DialogClose>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
