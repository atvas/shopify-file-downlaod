"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"

export type MigratePhase = "confirm" | "running" | "done"

export interface MigrateResultItem {
  name: string
  status: "migrated" | "skipped" | "error"
  error?: string
  warning?: string
}

interface MigrateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  phase: MigratePhase
  /** 弹窗标题，如「迁移元对象到目标站点」 */
  title: string
  /** 确认页说明（目标站点、数量、跳过规则） */
  description: string
  /** 确认页：待迁移清单 */
  items: string[]
  progress: { current: number; total: number } | null
  results: MigrateResultItem[]
  onConfirm: () => void
  /** 进行中取消：中断请求并回到确认页（与推送图片弹窗一致） */
  onCancel: () => void
}

/**
 * 迁移弹窗 —— 与 ImagePushDialog 同款样式和流程：
 * 确认（清单 + 说明）→ 进行中（进度条 + 逐条结果流入）→ 完成（汇总 + 失败明细）。
 */
export function MigrateDialog({
  open,
  onOpenChange,
  phase,
  title,
  description,
  items,
  progress,
  results,
  onConfirm,
  onCancel,
}: MigrateDialogProps) {
  const migrated = results.filter((r) => r.status === "migrated").length
  const skipped = results.filter((r) => r.status === "skipped").length
  const failed = results.filter((r) => r.status === "error").length
  const warned = results.filter((r) => r.warning).length

  return (
    // 进行中禁止点遮罩关闭（只能用弹窗里的「取消」/右上角 X）
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      disablePointerDismissal={phase === "running"}
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
          {phase === "confirm" && (
            <>
              <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>

              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border/30 bg-background/50 p-2">
                {items.map((name, i) => (
                  <div
                    key={`${name}-${i}`}
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
                      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                      <path d="m3.3 7 8.7 5 8.7-5" />
                      <path d="M12 22V12" />
                    </svg>
                    <span className="truncate">{name}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <DialogClose render={<Button variant="ghost" size="sm" />}>
                  取消
                </DialogClose>
                <Button size="sm" onClick={onConfirm}>
                  开始迁移
                </Button>
              </div>
            </>
          )}

          {phase === "running" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  正在迁移...
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
                    {r.status === "migrated" && (
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
                    {r.warning && (
                      <span className="truncate text-amber-600/80 dark:text-amber-400/80">
                        {r.warning}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={onCancel}>
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
                  <p className="text-sm font-medium">迁移完成</p>
                  <p className="text-xs text-muted-foreground">
                    {migrated > 0 && `${migrated} 迁移`}
                    {skipped > 0 && ` · ${skipped} 跳过`}
                    {failed > 0 && ` · ${failed} 失败`}
                    {warned > 0 && ` · ${warned} 带警告`}
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
                        <span className="truncate text-destructive/60">
                          {r.error}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              {warned > 0 && (
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {results
                    .filter((r) => r.warning)
                    .map((r, i) => (
                      <div
                        key={`warn-${i}`}
                        className="flex items-center gap-2 rounded px-2 py-1 text-xs text-amber-600 dark:text-amber-400"
                      >
                        <span className="truncate">{r.name}</span>
                        <span className="truncate text-amber-600/70 dark:text-amber-400/70">
                          {r.warning}
                        </span>
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
