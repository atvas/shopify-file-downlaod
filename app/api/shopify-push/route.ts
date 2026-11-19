import { NextResponse } from "next/server"
import { request as httpsRequest } from "node:https"
import {
  mapWithConcurrency,
  sanitizeDomain,
  SHOPIFY_API_VERSION,
  targetFileExists,
} from "@/lib/shopify"
import { readResponseBody } from "@/lib/stream"

type PushFileType = "image" | "video"
type PushPhase = "checking" | "download" | "upload" | "finalizing"
type FileProgressFn = (
  phase: PushPhase,
  received: number,
  total: number
) => void
type ByteProgressFn = (received: number, total: number) => void

interface StagedUploadTarget {
  url: string
  resourceUrl: string
  parameters: { name: string; value: string }[]
}

interface PushFile {
  /** 客户端生成的唯一标识，进度事件原样带回；缺省用数组下标 */
  id?: string
  url: string
  name: string
  type: PushFileType
}

/**
 * 同时处理的文件数。
 *
 * 单个文件内部是「下载 → 上传」串行，两个文件并行时，一个在下传、
 * 另一个在上传，正好把两段等待重叠起来。不再往上加是因为每个文件
 * 都完整读进内存，3 个 500MB 的视频会同时占 1.5GB。
 */
const PUSH_CONCURRENCY = 2

interface RequestBody {
  targetDomain: string
  targetToken: string
  files?: PushFile[]
  /** 旧版客户端只传 images，保留兼容 */
  images?: PushFile[]
}

const MIME_BY_EXT: Record<string, string> = {
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

function guessMimeType(fileName: string, type: PushFileType): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? ""
  return MIME_BY_EXT[ext] ?? (type === "video" ? "video/mp4" : "image/jpeg")
}

/** 节流进度事件：每 250ms 最多一条，起点与 100% 必须送达 */
function throttleProgress(onProgress: ByteProgressFn): ByteProgressFn {
  let lastAt = 0
  let lastReceived = -1

  return (received, total) => {
    const now = Date.now()
    const done = total > 0 && received >= total
    if (!done && received === lastReceived) return
    if (!done && now - lastAt < 250) return

    lastAt = now
    lastReceived = received
    onProgress(received, total)
  }
}

/** 创建 staged upload，获取上传 URL。图片与视频只是 resource 不同。 */
async function createStagedUpload(
  domain: string,
  token: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
  resource: "IMAGE" | "VIDEO"
): Promise<StagedUploadTarget> {
  const mutation = `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }`

  const res = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: [
            {
              // 视频必须用 VIDEO；图片用 IMAGE
              resource,
              filename: fileName,
              mimeType,
              fileSize: fileSize.toString(),
              httpMethod: "POST",
            },
          ],
        },
      }),
    }
  )

  if (!res.ok) {
    throw new Error(`创建 staged upload 失败 (${res.status})`)
  }

  const data = await res.json()
  const targets = data?.data?.stagedUploadsCreate?.stagedTargets
  const errors = data?.data?.stagedUploadsCreate?.userErrors

  if (errors?.length > 0) {
    throw new Error(`Staged upload 错误: ${errors[0].message}`)
  }

  if (!targets?.length) {
    throw new Error("未获取到 staged upload URL")
  }

  return targets[0]
}

/** multipart 头里的值不能带换行和引号，否则会破坏边界解析 */
function escapeMultipartValue(value: string): string {
  return value.replace(/[\r\n"]/g, "_")
}

/**
 * 把文件以 multipart/form-data 流式 POST 到 staged URL。
 *
 * 这里不用 `fetch` + `FormData`：那样只有整体完成才返回，大视频推送时
 * 客户端全程看不到任何进展。改成手写 multipart + `https.request`，
 * Content-Length 精确可知，每写完一个分片就能上报一次字节进度。
 */
async function uploadMultipart(
  uploadUrl: string,
  parameters: { name: string; value: string }[],
  fileName: string,
  mimeType: string,
  fileBuffer: Buffer,
  onProgress: ByteProgressFn
): Promise<void> {
  const boundary = `----ShopifyPush${Date.now().toString(16)}${Math.random()
    .toString(16)
    .slice(2)}`

  const fields = parameters
    .map(
      (param) =>
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${escapeMultipartValue(param.name)}"\r\n\r\n` +
        `${param.value}\r\n`
    )
    .join("")
  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${escapeMultipartValue(fileName)}"\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  const preamble = Buffer.from(fields + fileHeader, "utf8")
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  const totalLength =
    preamble.byteLength + fileBuffer.byteLength + epilogue.byteLength

  const report = throttleProgress(onProgress)
  onProgress(0, fileBuffer.byteLength)

  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(
      uploadUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": totalLength.toString(),
        },
      },
      (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          if (body.length < 4096) body += chunk
        })
        res.on("end", () => {
          const status = res.statusCode ?? 0
          if (status >= 200 && status < 300) {
            resolve()
          } else {
            reject(
              new Error(
                `上传到 staged URL 失败 (${status})${
                  body ? `: ${body.slice(0, 300)}` : ""
                }`
              )
            )
          }
        })
      }
    )

    req.setTimeout(60_000, () => {
      req.destroy(new Error("上传到 staged URL 超时"))
    })
    req.on("error", reject)

    const writeChunk = (chunk: Buffer) =>
      new Promise<void>((res, rej) => {
        req.write(chunk, (err) => (err ? rej(err) : res()))
      })

    void (async () => {
      try {
        await writeChunk(preamble)

        const CHUNK_SIZE = 512 * 1024
        let sent = 0
        for (
          let offset = 0;
          offset < fileBuffer.byteLength;
          offset += CHUNK_SIZE
        ) {
          const chunk = fileBuffer.subarray(offset, offset + CHUNK_SIZE)
          await writeChunk(chunk)
          sent += chunk.byteLength
          report(sent, fileBuffer.byteLength)
        }

        await writeChunk(epilogue)
        req.end()
      } catch (err) {
        req.destroy()
        reject(err)
      }
    })()
  })
}

/** 创建目标站点的文件记录（图片 / 视频共用） */
async function createFileRecord(
  domain: string,
  token: string,
  resourceUrl: string,
  fileName: string,
  resource: "IMAGE" | "VIDEO"
): Promise<void> {
  const mutation = `mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id alt }
      userErrors { field message }
    }
  }`

  const res = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          files: [
            {
              alt: fileName,
              contentType: resource,
              originalSource: resourceUrl,
            },
          ],
        },
      }),
    }
  )

  if (!res.ok) {
    throw new Error(`创建文件记录失败 (${res.status})`)
  }

  const data = await res.json()
  const errors = data?.data?.fileCreate?.userErrors

  if (errors?.length > 0) {
    throw new Error(`创建文件记录错误: ${errors[0].message}`)
  }
}

/** 通过 staged upload 上传文件二进制数据（视频唯一可行的上传路径） */
async function uploadViaStagedUpload(
  domain: string,
  token: string,
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
  type: PushFileType,
  onProgress: FileProgressFn
): Promise<void> {
  const resource = type === "video" ? "VIDEO" : "IMAGE"
  const fileBuffer = Buffer.from(buffer)

  onProgress("upload", 0, fileBuffer.byteLength)

  // 1. 创建 staged upload
  const staged = await createStagedUpload(
    domain,
    token,
    fileName,
    mimeType,
    fileBuffer.byteLength,
    resource
  )

  // 2. 上传到 staged URL（带字节进度）
  await uploadMultipart(
    staged.url,
    staged.parameters,
    fileName,
    mimeType,
    fileBuffer,
    (received, total) => onProgress("upload", received, total)
  )

  // 3. 创建文件记录
  onProgress("finalizing", 0, 0)
  await createFileRecord(domain, token, staged.resourceUrl, fileName, resource)
}

/** 把源文件下载到服务端（源 CDN 是公开读取，不带 token） */
async function downloadFile(
  fileUrl: string,
  fileName: string,
  type: PushFileType,
  onProgress: ByteProgressFn
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const res = await fetch(fileUrl)
  if (!res.ok) {
    throw new Error(`下载文件失败 (${res.status}): ${fileUrl}`)
  }

  const headerType = (res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase()

  // 状态码 200 也可能是 CDN 的 HTML 错误页，别把它当素材传上去
  if (headerType.includes("text/html")) {
    throw new Error(`源地址返回的是 HTML 页面而不是文件: ${fileUrl}`)
  }

  // 共享的流式读取：按 Content-Length 预分配 + 上报字节进度
  const buffer = await readResponseBody(res, throttleProgress(onProgress))

  const mimeType =
    headerType &&
    !headerType.includes("octet-stream") &&
    !headerType.startsWith("text/")
      ? headerType
      : guessMimeType(fileName, type)

  return { buffer, mimeType }
}

/** 上传单个文件到目标站点（图片优先 src 模式，视频直接 staged upload） */
async function uploadFile(
  domain: string,
  token: string,
  file: PushFile,
  onProgress: FileProgressFn
): Promise<"src" | "staged"> {
  let srcStatus = 0
  let srcError = ""

  // 策略 1: src 模式（仅图片 —— REST files 接口不接收视频）
  if (file.type === "image") {
    const srcRes = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/files.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          file: {
            src: file.url,
            alt: file.name,
          },
        }),
      }
    )

    if (srcRes.ok) return "src"

    srcStatus = srcRes.status
    try {
      const json = await srcRes.json()
      srcError = JSON.stringify(json.errors || json.error || json)
    } catch {
      srcError = await srcRes.text().catch(() => "")
    }
  }

  // 策略 2: 下载后直接上传（图片 src 模式失败时兜底，视频唯一路径）
  try {
    const { buffer, mimeType } = await downloadFile(
      file.url,
      file.name,
      file.type,
      (received, total) => onProgress("download", received, total)
    )
    await uploadViaStagedUpload(
      domain,
      token,
      buffer,
      file.name,
      mimeType,
      file.type,
      onProgress
    )
    return "staged"
  } catch (stagedErr) {
    const stagedMessage =
      stagedErr instanceof Error ? stagedErr.message : "未知错误"

    if (file.type === "video") {
      throw new Error(`上传视频失败: ${stagedMessage}`)
    }

    throw new Error(
      `上传失败:\n` +
        `- src 模式 (${srcStatus}): ${srcError}\n` +
        `- 直接上传: ${stagedMessage}`
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody
    const { targetDomain, targetToken, files: rawFiles, images } = body

    if (!targetDomain || !targetToken) {
      return NextResponse.json({ error: "缺少目标站点凭证" }, { status: 400 })
    }

    const items: PushFile[] = (rawFiles ?? images ?? [])
      .filter((f) => f?.url)
      .map((f, index) => ({
        id: f.id ?? String(index),
        url: f.url,
        name: f.name || f.url.split("/").pop()?.split("?")[0] || "file",
        type: f.type === "video" ? "video" : "image",
      }))

    if (items.length === 0) {
      return NextResponse.json({ error: "没有要推送的文件" }, { status: 400 })
    }

    const domain = sanitizeDomain(targetDomain)

    // NDJSON 流式响应：进度事件和最终结果共用一条流
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        let clientGone = false

        const write = (obj: Record<string, unknown>) => {
          if (clientGone) return
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
          } catch {
            // 客户端已断开（取消推送），别再往关闭的流里写
            clientGone = true
          }
        }

        await mapWithConcurrency(
          items,
          PUSH_CONCURRENCY,
          async (file): Promise<void> => {
            if (clientGone || request.signal.aborted) return

            try {
              write({
                id: file.id,
                name: file.name,
                type: file.type,
                status: "progress",
                phase: "checking",
                received: 0,
                total: 0,
              })

              const exists = await targetFileExists(
                domain,
                targetToken,
                file.name
              )
              if (exists) {
                write({
                  id: file.id,
                  name: file.name,
                  type: file.type,
                  status: "skipped",
                })
                return
              }

              const method = await uploadFile(
                domain,
                targetToken,
                file,
                (phase, received, total) => {
                  write({
                    id: file.id,
                    name: file.name,
                    type: file.type,
                    status: "progress",
                    phase,
                    received,
                    total,
                  })
                }
              )
              write({
                id: file.id,
                name: file.name,
                type: file.type,
                status: "uploaded",
                method, // "src" 或 "staged"
              })
            } catch (err) {
              write({
                id: file.id,
                name: file.name,
                type: file.type,
                status: "error",
                error: err instanceof Error ? err.message : "未知错误",
              })
            }
          }
        )

        try {
          controller.close()
        } catch {
          // 客户端已断开时流可能已经关闭
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "推送失败" },
      { status: 500 }
    )
  }
}
