"use client"

import { useCallback, useEffect, useState } from "react"
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog"

interface CodeDialogProps {
  /** section 文件路径，如 sections/main-product.liquid；null = 关闭 */
  sectionKey: string | null
  code: string | null
  /** 顶栏标题覆盖，默认使用 sectionKey */
  title?: string
  /** 下载文件名覆盖，默认从 sectionKey 取最后一段 */
  downloadName?: string
  onClose: () => void
}

export function CodeDialog({
  sectionKey,
  code,
  title,
  downloadName,
  onClose,
}: CodeDialogProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!sectionKey) setCopied(false)
  }, [sectionKey])

  const handleCopy = useCallback(async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }, [code])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose()
    },
    [onClose],
  )

  return (
    <Dialog open={!!sectionKey} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border-0 bg-card p-0 shadow-2xl sm:max-w-4xl"
        showCloseButton={false}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-border/50 bg-card/80 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-violet-500/10 text-violet-500">
              <svg
                className="h-3 w-3"
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
            </span>
            <span className="truncate font-mono text-xs font-medium text-foreground/80">
              {title ?? sectionKey}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                if (!code || !sectionKey) return
                const blob = new Blob([code], { type: "text/plain" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download =
                  downloadName ||
                  sectionKey.split("/").pop() ||
                  "section.liquid"
                document.body.appendChild(a)
                a.click()
                URL.revokeObjectURL(url)
                document.body.removeChild(a)
              }}
              className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              下载
            </button>
            <button
              onClick={handleCopy}
              className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? "已复制" : "复制"}
            </button>
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

        {/* 代码内容 */}
        <div className="relative flex-1 overflow-auto bg-[hsl(0,0%,98%)] dark:bg-[hsl(0,0%,8%)]">
          {code !== null ? (
            <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
              <code className="font-mono text-foreground/80">{code}</code>
            </pre>
          ) : (
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
