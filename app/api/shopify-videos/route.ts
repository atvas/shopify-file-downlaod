import { NextResponse } from "next/server"
import JSZip from "jszip"
import {
  mapWithConcurrency,
  normalizeUrl,
  resolveShopifyFileUrl,
  sanitizeDomain,
} from "@/lib/shopify"

interface VideoItem {
  url: string
  name?: string
}

interface RequestBody {
  storeDomain: string
  accessToken: string
  videoUrls: string[] | VideoItem[]
}

interface DownloadedFile {
  name: string
  buffer: ArrayBuffer
}

/** 并发下载数。每个文件都整个进内存，别开太高。 */
const DOWNLOAD_CONCURRENCY = 4

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
}

function getMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return MIME_TYPES[ext] ?? "application/octet-stream"
}

/** 去掉路径分隔符，避免 zip 里出现目录穿越式的条目名 */
function safeFileName(name: string): string {
  return name.split(/[\\/]/).pop()?.trim() || "file"
}

/**
 * 让扩展名与实际拿到的字节一致。
 *
 * 原始上传是 .mov 而 Shopify 只提供 mp4 转码档时，存成 .mov 会让系统用错程序
 * 打开。URL 的扩展名才反映真实内容，所以以它为准。
 */
function alignExtension(name: string, url: string): string {
  const segment = url.split("/").pop()?.split("?")[0] ?? ""
  const dotIndex = segment.lastIndexOf(".")

  // 最后一段没有点，说明 URL 里根本没扩展名，保持原名
  if (dotIndex <= 0) return name

  const urlExt = segment.slice(dotIndex + 1).toLowerCase()
  if (!/^[a-z0-9]{2,5}$/.test(urlExt)) return name

  const nameExt = name.split(".").pop()?.toLowerCase() ?? ""
  if (nameExt === urlExt) return name

  return name.includes(".")
    ? `${name.replace(/\.[^.]+$/, "")}.${urlExt}`
    : `${name}.${urlExt}`
}

/** Content-Disposition 的 ASCII 回退值 + RFC 5987 的 UTF-8 真值 */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** 把 `shopify://files/...` 或站内相对路径解析成可下载的绝对 URL */
async function toDownloadUrl(
  rawUrl: string,
  domain: string,
  accessToken: string
): Promise<{ url: string; resolvedName: string | null } | { error: string }> {
  if (rawUrl.startsWith("shopify://")) {
    const filePath = rawUrl.replace(/^shopify:\/\//, "")
    const result = await resolveShopifyFileUrl(domain, accessToken, filePath)

    if (!result.url) {
      return { error: `无法解析 ${rawUrl}:\n${result.errors.join("\n")}` }
    }
    return { url: result.url, resolvedName: result.filename }
  }

  const url = normalizeUrl(rawUrl)

  // 已经是绝对地址（含协议相对已补全）就直接用，不要再拼域名
  if (/^https?:\/\//i.test(url)) {
    return { url, resolvedName: null }
  }

  // 站内相对路径，补全店铺域名
  return {
    url: `https://${domain}${url.startsWith("/") ? "" : "/"}${url}`,
    resolvedName: null,
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody
    const { storeDomain, accessToken, videoUrls } = body

    if (!storeDomain || !accessToken || !videoUrls?.length) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 })
    }

    const domain = sanitizeDomain(storeDomain)

    // 兼容旧的 string[] 格式和新的 {url, name} 格式
    const items: VideoItem[] = videoUrls.map((v) =>
      typeof v === "string" ? { url: v } : v
    )

    // 并发下载。这里原来是一个接一个 `await`，10 个文件就是 10 段串行的
    // 往返加传输。上限 4 是因为每个文件都要整个读进内存再打包，
    // 并发太高会同时压住内存和带宽。
    const outcomes = await mapWithConcurrency(
      items,
      DOWNLOAD_CONCURRENCY,
      async (item): Promise<{ file?: DownloadedFile; error?: string }> => {
        try {
          const target = await toDownloadUrl(item.url, domain, accessToken)

          if ("error" in target) return { error: target.error }

          const response = await fetch(target.url)
          if (!response.ok) {
            return {
              error: `下载失败 ${item.url}: ${response.status} ${response.statusText}`,
            }
          }

          const buffer = await response.arrayBuffer()

          // 命名优先级：客户端给的原始名 > 解析出的真实名 > URL 反推 > 兜底。
          // 视频的 CDN URL 里是哈希名，所以必须让原始名排在 URL 反推之前。
          const name = alignExtension(
            safeFileName(
              item.name?.trim() ||
                target.resolvedName?.trim() ||
                target.url.split("/").pop()?.split("?")[0] ||
                `file-${Date.now()}`
            ),
            target.url
          )

          return { file: { name, buffer } }
        } catch (err) {
          return {
            error: `下载 ${item.url} 出错: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }
    )

    const downloaded: DownloadedFile[] = []
    const errors: string[] = []
    for (const outcome of outcomes) {
      if (outcome.file) downloaded.push(outcome.file)
      if (outcome.error) errors.push(outcome.error)
    }

    if (downloaded.length === 0) {
      return NextResponse.json(
        { error: "未能下载任何文件", details: errors },
        { status: 500 }
      )
    }

    // 单个文件：原样返回
    if (downloaded.length === 1) {
      const { name, buffer } = downloaded[0]
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": getMimeType(name),
          "Content-Disposition": contentDisposition(name),
        },
      })
    }

    // 多个文件：打包成 zip
    const zip = new JSZip()
    for (const file of downloaded) {
      zip.file(file.name, file.buffer)
    }
    if (errors.length > 0) {
      zip.file("下载失败记录.txt", errors.join("\n\n"))
    }

    const zipBuffer = await zip.generateAsync({ type: "arraybuffer" })

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="shopify-files-${Date.now()}.zip"`,
      },
    })
  } catch (err) {
    console.error("下载接口错误:", err)
    return NextResponse.json(
      {
        error: "服务器错误",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}
