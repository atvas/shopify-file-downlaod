"use client"

import { useState, useCallback, useRef } from "react"
import { type MediaFile, type ResolveResult } from "@/lib/types"
import { parseMediaUrls, parseSectionRefs, SectionRef } from "@/lib/parse"
import { getCurrentSource, getCurrentTarget } from "@/lib/stores"
import { useMounted } from "@/hooks/use-mounted"
import { PreviewDialog } from "@/components/preview-dialog"
import { CodeDialog } from "@/components/code-dialog"
import { StepTemplatePicker } from "@/components/step-template-picker"
import { StepCodeInfo } from "@/components/step-code-info"
import { StepDownload } from "@/components/step-download"
import { ErrorBanner } from "@/components/error-banner"
import { ImagePushDialog } from "@/components/image-push-dialog"

export default function Page() {
  // ── 全局状态 ─────────────────────────────────────────────────────────
  const mounted = useMounted()
  const [videos, setVideos] = useState<MediaFile[]>([])
  const [error, setError] = useState("")
  const [resolving, setResolving] = useState(false)

  // API 凭证：来自店铺配置页（/config）的「当前源 / 当前目标」
  const [storeDomain] = useState(() => getCurrentSource()?.domain ?? "")
  const [accessToken] = useState(() => getCurrentSource()?.token ?? "")
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null)

  // 模板数据
  const [templateJson, setTemplateJson] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [sections, setSections] = useState<SectionRef[]>([])

  // 预览
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Section 代码查看
  const [viewingSection, setViewingSection] = useState<string | null>(null)
  const [sectionCode, setSectionCode] = useState<string | null>(null)

  // 模板 JSON 弹窗
  const [viewingTemplateJson, setViewingTemplateJson] = useState(false)

  // 目标站点（店铺配置的「当前目标」，可选）
  const [targetDomain] = useState(() => getCurrentTarget()?.domain ?? "")
  const [targetToken] = useState(() => getCurrentTarget()?.token ?? "")

  // 图片 Push 弹窗
  const [pushDialogOpen, setPushDialogOpen] = useState(false)
  const [pushImages, setPushImages] = useState<MediaFile[]>([])

  const handlePushImages = useCallback((images: MediaFile[]) => {
    setPushImages(images)
    setPushDialogOpen(true)
  }, [])

  // ── 回调 ─────────────────────────────────────────────────────────────

  const handleSelectionStart = useCallback((key: string) => {
    setVideos([])
    setTemplateJson(null)
    setSections([])
    setViewingTemplateJson(false)
    setSelectedKey(key)
  }, [])

  // 选完模板解析出素材后，自动把视口带到素材/下载区
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const scrollToResults = useCallback(() => {
    requestAnimationFrame(() =>
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    )
  }, [])

  const handleTemplateContent = useCallback(
    async (key: string, content: string) => {
      setSelectedKey(key)
      setTemplateJson(content)
      setError("")
      try {
        const parsed = parseMediaUrls(content)
        setSections(parseSectionRefs(content))

        if (parsed.length === 0) {
          setVideos([])
          setError("未找到素材文件（视频或图片）")
          return
        }

        const direct = parsed.map((f) => ({
          ...f,
          resolvedUrl: /^https?:\/\//i.test(f.url) ? f.url : null,
        }))

        const shopifyUrls = direct
          .filter((f) => !f.resolvedUrl)
          .map((f) => f.url)

        if (shopifyUrls.length > 0) {
          if (!storeDomain || !accessToken) {
            setError(
              "存在 shopify:// 协议的文件，请先在店铺配置中设置当前源店铺再解析"
            )
            setVideos(direct)
            return
          }

          setResolving(true)
          setVideos(direct)
          scrollToResults()

          const failures: string[] = []

          const applyResolved = (items: ResolveResult[]) => {
            if (items.length === 0) return
            const resolveMap = new Map(items.map((r) => [r.original, r]))
            setVideos((prev) =>
              prev.map((f) => {
                if (f.resolvedUrl) return f
                const hit = resolveMap.get(f.url)
                if (!hit?.resolved) return f
                return {
                  ...f,
                  resolvedUrl: hit.resolved,
                  name: hit.filename || f.name,
                }
              })
            )
          }

          const collect = (items: ResolveResult[]) => {
            for (const item of items) {
              if (!item.resolved) {
                failures.push(item.error || `无法解析 ${item.original}`)
              }
            }
            applyResolved(items)
          }

          try {
            const res = await fetch("/api/shopify-resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storeDomain,
                accessToken,
                urls: shopifyUrls,
              }),
            })

            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              throw new Error(data.error || "解析链接失败")
            }
            if (!res.body) throw new Error("解析链接失败")

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            for (;;) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""

              collect(
                lines
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .flatMap((line) => {
                    try {
                      return [JSON.parse(line) as ResolveResult]
                    } catch {
                      return []
                    }
                  })
              )
            }

            const tail = buffer.trim()
            if (tail) {
              try {
                const item = JSON.parse(tail) as ResolveResult
                collect([item])
              } catch {
                // ignore
              }
            }

            if (failures.length > 0) setError(failures.join("\n\n"))
          } catch (err) {
            setError(err instanceof Error ? err.message : "解析链接失败")
          } finally {
            setResolving(false)
          }
        } else {
          setVideos(direct)
          scrollToResults()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "解析失败")
      }
    },
    [storeDomain, accessToken, scrollToResults]
  )

  // ── Section 代码查看 ────────────────────────────────────────────────
  const handleViewSection = useCallback(
    async (key: string) => {
      if (!selectedThemeId) return
      setViewingSection(key)
      setSectionCode(null)
      try {
        const res = await fetch("/api/shopify-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeDomain,
            accessToken,
            action: "get-template",
            themeId: selectedThemeId,
            key,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || "获取 Section 内容失败")
        setSectionCode(data.content ?? "")
      } catch (err) {
        setSectionCode(
          `// 加载失败: ${err instanceof Error ? err.message : "未知错误"}`
        )
      }
    },
    [selectedThemeId, storeDomain, accessToken]
  )

  const closeCodeDialog = useCallback(() => {
    setViewingSection(null)
  }, [])

  // ── 预览 ─────────────────────────────────────────────────────────────
  const handlePreview = useCallback((file: MediaFile) => {
    const src = file.resolvedUrl || file.url
    const url =
      file.type === "video"
        ? src + (src.includes("?") ? "&" : "?") + "width=1200"
        : src
    setPreviewFile(file)
    setPreviewUrl(url)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewFile(null)
  }, [])

  // ── Loading skeleton ────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
      {/* Step 1: 选择主题 & 模板 */}
      <StepTemplatePicker
        storeDomain={storeDomain}
        accessToken={accessToken}
        resolving={resolving}
        videoCount={videos.filter((v) => v.type === "video").length}
        imageCount={videos.filter((v) => v.type === "image").length}
        selectedKey={selectedKey}
        onTemplateContent={handleTemplateContent}
        onError={setError}
        onResolvingChange={setResolving}
        onSelectionStart={handleSelectionStart}
        onThemeChange={setSelectedThemeId}
      />

      {/* Step 2: 模板代码信息 */}
      <StepCodeInfo
        templateJson={templateJson}
        selectedKey={selectedKey}
        sections={sections}
        resolving={resolving}
        onViewSection={handleViewSection}
        onViewTemplateJson={() => setViewingTemplateJson(true)}
      />

      {/* 错误提示 */}
      <ErrorBanner error={error} />

      {/* Step 3: 文件下载 */}
      <div ref={resultsRef} className="scroll-mt-20">
        <StepDownload
          videos={videos}
          resolving={resolving}
          storeDomain={storeDomain}
          accessToken={accessToken}
          targetDomain={targetDomain}
          targetToken={targetToken}
          onVideosChange={setVideos}
          onPreview={handlePreview}
          onError={setError}
          onPushImages={handlePushImages}
        />
      </div>
      {/* ── 预览 Dialog ──────────────────────────────────────────────── */}
      <PreviewDialog
        file={previewFile}
        previewUrl={previewUrl}
        onClose={closePreview}
      />

      {/* ── Section 代码 Dialog ──────────────────────────────────────── */}
      <CodeDialog
        sectionKey={viewingSection}
        code={sectionCode}
        onClose={closeCodeDialog}
      />

      {/* ── 模板 JSON Dialog ─────────────────────────────────────── */}
      <CodeDialog
        sectionKey={
          viewingTemplateJson ? (selectedKey ?? "template.json") : null
        }
        code={templateJson}
        title={selectedKey?.replace(/^templates\//, "") || "模板 JSON"}
        downloadName={
          selectedKey?.replace(/^templates\//, "") || "template.json"
        }
        onClose={() => setViewingTemplateJson(false)}
      />

      {/* ── 图片 Push Dialog ─────────────────────────────────────── */}
      <ImagePushDialog
        open={pushDialogOpen}
        images={pushImages}
        targetDomain={targetDomain}
        targetToken={targetToken}
        onClose={() => setPushDialogOpen(false)}
        onError={setError}
      />
    </div>
  )
}
