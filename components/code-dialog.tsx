"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createHighlighter, type ShikiTransformer } from "shiki"
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

/* ---------- 语言检测 ---------- */

const LANG_MAP: Record<string, string> = {
  liquid: "liquid",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  js: "javascript",
  ts: "typescript",
  json: "json",
  md: "markdown",
  svg: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
}

function detectLang(filename: string | null): string {
  if (!filename) return "text"
  const ext = filename.split(".").pop()?.toLowerCase()
  return (ext && LANG_MAP[ext]) || "text"
}

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["one-dark-pro"],
      langs: [
        "liquid",
        "html",
        "css",
        "scss",
        "javascript",
        "typescript",
        "json",
        "markdown",
        "xml",
        "yaml",
        "bash",
      ],
    })
  }
  return highlighterPromise
}

/* ---------- 行号 Transformer ---------- */

const lineNumbers: ShikiTransformer = {
  line(node, line) {
    node.children.unshift({
      type: "element",
      tagName: "span",
      properties: {
        class: "line-number",
        "data-line": line,
      },
      children: [{ type: "text", value: String(line) }],
    })
  },
}

/* ---------- 主题背景色缓存 ---------- */

const THEME_BG: Record<string, string> = {
  "one-dark-pro": "#282c34",
  "material-theme-darker": "#212121",
}

/* ---------- 组件 ---------- */

export function CodeDialog({
  sectionKey,
  code,
  title,
  downloadName,
  onClose,
}: CodeDialogProps) {
  const [copied, setCopied] = useState(false)
  const [highlighted, setHighlighted] = useState<string>("")
  const [highlighting, setHighlighting] = useState(false)
  const [displayedCode, setDisplayedCode] = useState<string | null>(null)
  const [bg, setBg] = useState("#282c34")

  useEffect(() => {
    if (!sectionKey) {
      setCopied(false)
      setDisplayedCode(null)
      return
    }
    // 弹窗打开时先显示 spinner，等入场动画播完再给内容
    setDisplayedCode(null)
    const t = setTimeout(() => setDisplayedCode(code), 200)
    return () => clearTimeout(t)
  }, [sectionKey, code])

  const lang = useMemo(() => detectLang(sectionKey), [sectionKey])

  useEffect(() => {
    if (!displayedCode || lang === "text") {
      if (!displayedCode) setHighlighted("")
      return
    }
    let cancelled = false
    setHighlighting(true)
    getHighlighter().then((hl) => {
      if (cancelled) return
      const theme = "one-dark-pro"
      const html = hl.codeToHtml(displayedCode, {
        lang,
        theme,
        transformers: [lineNumbers],
      })
      if (!cancelled) {
        setHighlighted(html)
        setHighlighting(false)
        setBg(THEME_BG[theme] || "#282c34")
      }
    })
    return () => {
      cancelled = true
    }
  }, [displayedCode, lang])

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
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border-0 bg-card p-0 shadow-2xl sm:max-w-6xl"
        showCloseButton={false}
      >
        {/* 顶栏 */}
        <div
          className="flex items-center justify-between border-b border-white/5 px-4 py-2.5 backdrop-blur-sm"
          style={{ backgroundColor: bg }}
        >
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
            <span className="truncate font-mono text-xs font-medium text-white/80">
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
              className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              下载
            </button>
            <button
              onClick={handleCopy}
              className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              {copied ? "已复制" : "复制"}
            </button>
            <DialogClose
              render={
                <button className="flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white/80" />
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
        <div
          className="relative flex-1 overflow-auto [&_pre]:m-0 [&_pre]:overflow-visible [&_pre]:rounded-none [&_pre]:border-0 [&_pre]:bg-transparent [&_pre]:w-fit  [&_pre]:pr-4 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_.line]:inline-block [&_.line]:min-w-full [&_.line-number]:sticky [&_.line-number]:left-0 [&_.line-number]:z-[1] [&_.line-number]:inline-block [&_.line-number]:w-10 [&_.line-number]:shrink-0 [&_.line-number]:select-none [&_.line-number]:pr-3 [&_.line-number]:text-right [&_.line-number]:text-white/20"
          style={{
            backgroundColor: bg,
            scrollbarColor: `rgba(255,255,255,0.15) transparent`,
            ["--code-bg" as string]: bg,
          }}
        >
          {/* 高亮进行中的 loading 条 */}
          {highlighting && (
            <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden">
              <div
                className="h-full w-2/5 animate-[shiki-loading_1.2s_ease-in-out_infinite] rounded-full bg-violet-500"
              />
            </div>
          )}
          {displayedCode !== null ? (
            lang !== "text" && highlighted ? (
              <div
                className="shiki"
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            ) : (
              <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
                <code className="font-mono text-white/80">{displayedCode}</code>
              </pre>
            )
          ) : (
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            </div>
          )}
        </div>
        {/* loading 条动画 + 行号背景 */}
        <style>{`@keyframes shiki-loading{0%{transform:translateX(-100%)}50%{transform:translateX(150%)}100%{transform:translateX(-100%)}}.line-number{background-color:var(--code-bg)}`}</style>
      </DialogContent>
    </Dialog>
  )
}
