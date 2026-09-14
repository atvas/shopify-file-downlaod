import type { MediaFile } from "@/lib/types"

/**
 * 从 Shopify 模板 JSON 中解析媒体 URL。
 * 返回 MediaFile[]，可直接用于下载列表。
 */
export function parseMediaUrls(json: string): MediaFile[] {
  const videoPattern = /\.(mp4|webm|mov|avi|m4v)(\?[^"'\s]*)?$/i
  const imagePattern =
    /\.(png|jpg|jpeg|svg|gif|webp|avif|bmp|tiff?)(\?[^"'\s]*)?$/i

  // 关键修复 1：严格限制开头 ^ 和结尾 $，防止将包含 URL 的整段 HTML 误判为纯 URL
  const shopifyCdnPattern =
    /^(https?:)?\/\/cdn\.shopify\.com.*\.(mp4|webm|mov|avi|png|jpg|jpeg|svg|gif|webp)(\?[^"'\s]*)?$/i

  // 关键修复 2：同步兼容 shopify://files/ 和 shopify://shop_images/
  const shopifyFilePattern = /^shopify:\/\/(files|shop_images)\/.+/i

  const items = new Map<string, MediaFile>()

  const mediaExtRe =
    /\.(mp4|webm|mov|avi|m4v|png|jpg|jpeg|svg|gif|webp|avif|bmp|tiff?)/i
  const urlInHtmlRe = new RegExp(
    `(?:src|href|content)=["']([^"']*${mediaExtRe.source}[^"']*)["']`,
    "gi",
  )
  const srcsetUrlRe = new RegExp(`([^"'\\s,]+${mediaExtRe.source})`, "gi")
  const cssUrlRe = new RegExp(
    `url\\(["']?([^"'\\)]*${mediaExtRe.source}[^"'\\)]*)["']?\\)`,
    "gi",
  )

  function tryAddUrl(raw: string): boolean {
    const trimmed = raw.trim()
    if (!trimmed) return false

    // 如果包含 < 字符（说明是 HTML 片段），绝对不作为纯 URL 处理，直接返回 false 走后面的 extractUrlsFromHtml 提取
    if (trimmed.includes("<")) return false

    const clean = trimmed.split("?")[0]

    if (videoPattern.test(trimmed)) {
      items.set(clean, {
        url: clean,
        name: "",
        type: "video",
        selected: false,
      })
      return true
    } else if (imagePattern.test(trimmed)) {
      items.set(clean, {
        url: clean,
        name: "",
        type: "image",
        selected: false,
      })
      return true
    } else if (shopifyCdnPattern.test(trimmed)) {
      const isVideo = /\.(mp4|webm|mov|avi)/i.test(trimmed)
      items.set(clean, {
        url: clean,
        name: "",
        type: isVideo ? "video" : "image",
        selected: false,
      })
      return true
    } else if (shopifyFilePattern.test(trimmed)) {
      const ext = clean.split(".").pop()?.toLowerCase() || ""
      const videoExts = ["mp4", "webm", "mov", "avi", "m4v"]
      items.set(clean, {
        url: clean,
        name: "",
        type: videoExts.includes(ext) ? "video" : "image",
        selected: false,
      })
      return true
    }
    return false
  }

  /**
   * 从 HTML / 纯文本片段中提取所有媒体 URL。
   * 覆盖 src=""、href=""、srcset、CSS url() 等常见嵌入方式。
   */
  function extractUrlsFromHtml(html: string): void {
    let match

    // src="..." / href="..." / content="..."
    urlInHtmlRe.lastIndex = 0
    while ((match = urlInHtmlRe.exec(html)) !== null) {
      tryAddUrl(match[1])
    }

    // srcset — 可能包含多个 URL，用逗号分隔
    srcsetUrlRe.lastIndex = 0
    while ((match = srcsetUrlRe.exec(html)) !== null) {
      tryAddUrl(match[1])
    }

    // CSS url(...)
    cssUrlRe.lastIndex = 0
    while ((match = cssUrlRe.exec(html)) !== null) {
      tryAddUrl(match[1])
    }
  }

  try {
    // 自动去除 Shopify 模板中的 /* */ 块注释和 // 单行注释
    const cleaned = json
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .trim()
    const obj = JSON.parse(cleaned)

    function extractUrls(data: unknown): void {
      if (typeof data === "string") {
        const trimmed = data.trim()
        // 先尝试把整个字符串当作纯 URL，失败了（包括含有 HTML 标签的情况）再进入 HTML 解包逻辑
        if (!tryAddUrl(trimmed)) {
          if (
            trimmed.includes("src=") ||
            trimmed.includes("href=") ||
            trimmed.includes("url(") ||
            trimmed.includes("srcset") ||
            trimmed.includes("<img")
          ) {
            extractUrlsFromHtml(trimmed)
          }
        }
      } else if (Array.isArray(data)) {
        data.forEach(extractUrls)
      } else if (data && typeof data === "object") {
        Object.values(data).forEach(extractUrls)
      }
    }

    extractUrls(obj)
  } catch {
    throw new Error("无效的 JSON 格式")
  }

  for (const item of items.values()) {
    if (!item.name) {
      item.name =
        item.url.split("/").pop()?.split("?")[0] ||
        `unknown.${item.type === "video" ? "mp4" : "png"}`
    }
  }

  return Array.from(items.values())
}
