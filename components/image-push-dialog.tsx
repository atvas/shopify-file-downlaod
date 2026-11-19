"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog"
import { type MediaFile } from "@/lib/types"
import { readNdjson } from "@/lib/ndjson"
import { IconImage, IconVideo } from "@/components/icons"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"

interface PushResult {
  id?: string
  name: string
  type?: "video" | "image"
  status: "uploaded" | "skipped" | "error"
  error?: string
}

type PushPhase = "checking" | "download" | "upload" | "finalizing"

/** 服务端在下载 / 上传过程中按字节推来的进度事件 */
interface PushProgressEvent {
  id?: string
  name: string
  type?: "video" | "image"
  status: "progress"
  phase: PushPhase
  received?: number
  total?: number
}

type PushEvent = PushResult | PushProgressEvent

function formatProgress(event: PushProgressEvent): string {
  if (event.phase === "checking") return "检查目标站点..."
  if (event.phase === "finalizing") return "创建文件记录..."

  const label = event.phase === "download" ? "下载源文件" : "上传到目标站点"
  const total = event.total ?? 0
  const received = event.received ?? 0
  if (total <= 0) return label

  return `${label} ${Math.min(100, Math.round((received / total) * 100))}%`
}

interface MediaPushDialogProps {
  open: boolean
  files: MediaFile[]
  targetDomain: string
  targetToken: string
  onClose: () => void
  onError: (msg: string) => void
}

/**
 * 图片 / 视频共用的推送弹窗（历史文件名 image-push-dialog）。
 * 目标站点已有同名文件时由服务端自动跳过。
 */
export function MediaPushDialog({
  open,
  files,
  targetDomain,
  targetToken,
  onClose,
  onError,
}: MediaPushDialogProps) {
  const [phase, setPhase] = useState<"input" | "pushing" | "done">("input")
  const [results, setResults] = useState<PushResult[]>([])
  const [progress, setProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  // 正在处理的文件（可并行多个）及其阶段 / 字节进度
  const [active, setActive] = useState<Record<string, PushProgressEvent>>({})
  const abortRef = useRef<AbortController | null>(null)

  // 重置状态。setState 放进微任务，避免同步 setState-in-effect
  //（与 lib/list-cache.ts 的自动加载同一处理方式）
  useEffect(() => {
    if (!open) return
    Promise.resolve().then(() => {
      setPhase("input")
      setResults([])
      setProgress(null)
      setActive({})
    })
  }, [open])

  const handlePush = useCallback(async () => {
    if (!targetDomain || !targetToken) {
      onError("请先在店铺配置中设置当前目标店铺")
      return
    }
    if (files.length === 0) return

    const ac = new AbortController()
    abortRef.current = ac

    setPhase("pushing")
    setResults([])
    setProgress({ current: 0, total: files.length })
    onError("")

    try {
      const res = await fetch("/api/shopify-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDomain,
          targetToken,
          files: files.map((file, i) => ({
            id: String(i),
            url: file.resolvedUrl || file.url,
            name: file.name,
            type: file.type,
          })),
        }),
        signal: ac.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "推送失败")
      }
      if (!res.body) throw new Error("推送失败")

      let count = 0

      await readNdjson<PushEvent>(res, (event) => {
        // 进度事件只更新「进行中的文件」，不进入完成列表
        if (event.status === "progress") {
          const key = event.id ?? event.name
          setActive((prev) => ({ ...prev, [key]: event }))
          return
        }

        count++
        setResults((prev) => [...prev, event])
        setProgress({ current: count, total: files.length })

        // 该文件已出最终结果，从进行中列表移除
        const key = event.id ?? event.name
        setActive((prev) => {
          if (!(key in prev)) return prev
          const next = { ...prev }
          delete next[key]
          return next
        })
      })

      setPhase("done")
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      onError(err instanceof Error ? err.message : "推送失败")
      setPhase("input")
    }
  }, [targetDomain, targetToken, files, onError])

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
    [phase, onClose]
  )

  const uploaded = results.filter((r) => r.status === "uploaded").length
  const skipped = results.filter((r) => r.status === "skipped").length
  const failed = results.filter((r) => r.status === "error").length
  const videoUploaded = results.filter(
    (r) => r.status === "uploaded" && r.type === "video"
  ).length

  const videoCount = files.filter((f) => f.type === "video").length
  const imageCount = files.filter((f) => f.type === "image").length
  const title =
    videoCount > 0 && imageCount === 0
      ? "推送视频到目标站点"
      : imageCount > 0 && videoCount === 0
        ? "推送图片到目标站点"
        : "推送素材到目标站点"

  return (
    // 进行中禁止点遮罩关闭（与迁移弹窗一致）
    <Dialog
      open={open}
      onOpenChange={handleClose}
      disablePointerDismissal={phase === "pushing"}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border-0 bg-card p-0 shadow-2xl sm:max-w-lg"
        showCloseButton={false}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-border/50 bg-card/80 px-4 py-2.5 backdrop-blur-sm">
          <span className="text-sm font-medium">{title}</span>
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
                  将推送 {files.length} 个文件，已存在的文件会自动跳过
                </p>
                {videoCount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    视频上传后目标站点会自动转码，可在「内容 → 文件」中查看
                  </p>
                )}
              </div>

              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border/30 bg-background/50 p-2">
                {files.map((file) => (
                  <div
                    key={file.url}
                    className="flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground"
                  >
                    {file.type === "video" ? (
                      <IconVideo className="h-3 w-3 shrink-0 text-blue-500" />
                    ) : (
                      <IconImage className="h-3 w-3 shrink-0 text-emerald-500" />
                    )}
                    <span className="truncate">{file.name}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <DialogClose render={<Button variant="ghost" size="sm" />}>
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

              {/* 进行中的文件（并行时最多 PUSH_CONCURRENCY 条） */}
              {Object.entries(active).map(([key, event]) => (
                <div
                  key={key}
                  className="space-y-1.5 rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-muted-foreground">
                      {event.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground tabular-nums">
                      {formatProgress(event)}
                      {(event.phase === "checking" ||
                        event.phase === "finalizing") && (
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                      )}
                    </span>
                  </div>
                  {(event.phase === "download" || event.phase === "upload") &&
                    (event.total ?? 0) > 0 && (
                      <Progress
                        value={Math.min(
                          100,
                          (100 * (event.received ?? 0)) / (event.total ?? 1)
                        )}
                        className="gap-1"
                      />
                    )}
                </div>
              ))}

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
                <Button variant="outline" size="sm" onClick={handleCancel}>
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
                  {videoUploaded > 0 && (
                    <p className="text-[11px] text-muted-foreground/70">
                      视频在目标站点仍需转码，稍后可在「内容 → 文件」中查看
                    </p>
                  )}
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
                        <span className="text-destructive/60">{r.error}</span>
                      </div>
                    ))}
                </div>
              )}

              <div className="flex justify-end">
                <DialogClose render={<Button size="sm" />}>完成</DialogClose>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
