"use client"

import { useState, useCallback, useRef } from "react"
import { type MediaFile, type ResolveResult } from "@/lib/types"
import { readNdjson } from "@/lib/ndjson"
import { parseMediaUrls, parseSectionRefs, SectionRef } from "@/lib/parse"
import { getCurrentSource, getCurrentTarget } from "@/lib/stores"
import { useMounted } from "@/hooks/use-mounted"
import { PreviewDialog } from "@/components/preview-dialog"
import { CodeDialog } from "@/components/code-dialog"
import { StepTemplatePicker } from "@/components/step-template-picker"
import { TemplateInfo } from "@/components/template-info"
import { StepDownload } from "@/components/step-download"
import { ErrorBanner } from "@/components/error-banner"
import { MediaPushDialog } from "@/components/image-push-dialog"

export default function Page() {
  // ── 全局状态 ─────────────────────────────────────────────────────────
  const mounted = useMounted()
  const [videos, setVideos] = useState<MediaFile[]>([])
  const [error, setError] = useState("")
  const [resolving, setResolving] = useState(false)
  // 解析进度（已出结果 / 总数）与解析失败的原始 URL
  const [resolveProgress, setResolveProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [failedUrls, setFailedUrls] = useState<string[]>([])

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

  // 素材 Push 弹窗（图片 / 视频）
  const [pushDialogOpen, setPushDialogOpen] = useState(false)
  const [pushFiles, setPushFiles] = useState<MediaFile[]>([])

  const handlePushFiles = useCallback((files: MediaFile[]) => {
    setPushFiles(files)
    setPushDialogOpen(true)
  }, [])

  // ── 回调 ─────────────────────────────────────────────────────────────

  const handleSelectionStart = useCallback((key: string) => {
    setVideos([])
    setTemplateJson(null)
    setSections([])
    setViewingTemplateJson(false)
    setSelectedKey(key)
    setFailedUrls([])
    setResolveProgress(null)
    setPreviewFile(null)
    setPreviewUrl(null)
  }, [])

  // 选完模板解析出素材后，自动把视口带到素材/下载区
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const scrollToResults = useCallback(() => {
    requestAnimationFrame(() =>
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    )
  }, [])

  /**
   * 解析一批 shopify:// URL，结果逐条写回 videos。
   * 返回本次仍未解析成功的 URL，供「重试失败项」复用。
   */
  const resolveShopifyUrls = useCallback(
    async (urls: string[]): Promise<string[]> => {
      if (urls.length === 0) return []

      const failures: string[] = []
      const resolvedUrls = new Set<string>()
      let done = 0

      setResolving(true)
      setResolveProgress({ done: 0, total: urls.length })

      const applyResolved = (item: ResolveResult) => {
        if (item.resolved) resolvedUrls.add(item.original)
        else failures.push(item.error || `无法解析 ${item.original}`)

        setVideos((prev) =>
          prev.map((f) => {
            if (f.resolvedUrl || f.url !== item.original) return f
            if (!item.resolved) return f
            return {
              ...f,
              resolvedUrl: item.resolved,
              name: item.filename || f.name,
              size: item.size ?? f.size ?? null,
              width: item.width ?? f.width ?? null,
              height: item.height ?? f.height ?? null,
            }
          })
        )
      }

      try {
        const res = await fetch("/api/shopify-resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storeDomain, accessToken, urls }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || "解析链接失败")
        }

        await readNdjson<ResolveResult>(res, (item) => {
          done++
          setResolveProgress({ done, total: urls.length })
          applyResolved(item)
        })

        if (failures.length > 0) setError(failures.join("\n\n"))
      } catch (err) {
        setError(err instanceof Error ? err.message : "解析链接失败")
      } finally {
        setResolving(false)
        setResolveProgress(null)
      }

      const failed = urls.filter((url) => !resolvedUrls.has(url))
      setFailedUrls(failed)
      return failed
    },
    [storeDomain, accessToken]
  )

  const handleTemplateContent = useCallback(
    async (key: string, content: string) => {
      setSelectedKey(key)
      setTemplateJson(content)
      setError("")
      setFailedUrls([])
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

        if (shopifyUrls.length > 0 && (!storeDomain || !accessToken)) {
          setError(
            "存在 shopify:// 协议的文件，请先在店铺配置中设置当前源店铺再解析"
          )
          setVideos(direct)
          return
        }

        setVideos(direct)
        scrollToResults()

        if (shopifyUrls.length > 0) {
          await resolveShopifyUrls(shopifyUrls)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "解析失败")
      }
    },
    [storeDomain, accessToken, scrollToResults, resolveShopifyUrls]
  )

  const handleRetryFailed = useCallback(async () => {
    if (failedUrls.length === 0 || resolving) return
    setError("")
    await resolveShopifyUrls(failedUrls)
  }, [failedUrls, resolving, resolveShopifyUrls])

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
    setPreviewFile(file)
    setPreviewUrl(file.resolvedUrl || file.url)
  }, [])

  const closePreview = useCallback(() => {
    setPreviewFile(null)
  }, [])

  // 预览切换只走已解析的素材
  const previewList = videos.filter((v) => !!v.resolvedUrl)
  const previewIndex = previewFile
    ? previewList.findIndex((v) => v.url === previewFile.url)
    : -1

  const handlePreviewStep = useCallback(
    (delta: number) => {
      if (!previewFile) return
      const list = videos.filter((v) => !!v.resolvedUrl)
      const index = list.findIndex((v) => v.url === previewFile.url)
      if (index < 0) return

      const next = list[(index + delta + list.length) % list.length]
      if (!next) return

      setPreviewFile(next)
      setPreviewUrl(next.resolvedUrl || next.url)
    },
    [previewFile, videos]
  )

  // ── Loading skeleton ────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-340 px-4 pt-8 pb-12 md:px-8 md:pt-10">
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
        footer={
          <TemplateInfo
            templateJson={templateJson}
            selectedKey={selectedKey}
            sections={sections}
            resolving={resolving}
            onViewSection={handleViewSection}
            onViewTemplateJson={() => setViewingTemplateJson(true)}
          />
        }
      />

      {/* 两步之间的唯一分割线 */}
      <div className="my-8 h-px bg-[#EFEFEF] dark:bg-border" />

      {/* 错误提示 */}
      {error ? (
        <div className="mb-6">
          <ErrorBanner error={error} />
        </div>
      ) : null}

      {/* Step 2: 素材列表 & 下载/推送 */}
      <div ref={resultsRef} className="scroll-mt-20">
        <StepDownload
          videos={videos}
          resolving={resolving}
          resolveProgress={resolveProgress}
          failedCount={failedUrls.length}
          storeDomain={storeDomain}
          accessToken={accessToken}
          targetDomain={targetDomain}
          targetToken={targetToken}
          onRetryFailed={handleRetryFailed}
          onVideosChange={setVideos}
          onPreview={handlePreview}
          onError={setError}
          onPushFiles={handlePushFiles}
        />
      </div>
      {/* ── 预览 Dialog ──────────────────────────────────────────────── */}
      <PreviewDialog
        file={previewFile}
        previewUrl={previewUrl}
        position={
          previewIndex >= 0
            ? { index: previewIndex + 1, total: previewList.length }
            : null
        }
        onPrev={() => handlePreviewStep(-1)}
        onNext={() => handlePreviewStep(1)}
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

      {/* ── 素材 Push Dialog ─────────────────────────────────────── */}
      <MediaPushDialog
        open={pushDialogOpen}
        files={pushFiles}
        targetDomain={targetDomain}
        targetToken={targetToken}
        onClose={() => setPushDialogOpen(false)}
        onError={setError}
      />
    </div>
  )
}
