"use client"

import { useCallback, useState, type MouseEvent } from "react"
import { cn } from "@/lib/utils"

/** 复制素材的 CDN 地址，粘贴到目标主题时很常用 */
export function CopyUrlButton({
  url,
  className,
  title = "复制 CDN 链接",
}: {
  url: string
  className?: string
  title?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(
    async (event: MouseEvent) => {
      event.stopPropagation()
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      } catch {
        // 剪贴板不可用（非安全上下文 / 权限被拒）时静默失败
      }
    },
    [url]
  )

  return (
    <button
      type="button"
      title={copied ? "已复制" : title}
      aria-label={copied ? "已复制" : title}
      onClick={handleCopy}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {copied ? (
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}
