import { NextResponse } from "next/server"
import { resolveShopifyPaths, sanitizeDomain } from "@/lib/shopify"

interface RequestBody {
  storeDomain: string
  accessToken: string
  urls: string[]
}

interface ResolvedEntry {
  original: string
  resolved: string | null
  /** 原始文件名，供客户端命名下载文件 */
  filename: string | null
  error?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody
    const { storeDomain, accessToken, urls } = body

    if (!storeDomain || !accessToken || !urls?.length) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 })
    }

    const domain = sanitizeDomain(storeDomain)

    const shopifyEntries = urls
      .filter((u) => u.startsWith("shopify://"))
      .map((original) => {
        const filePath = original.replace(/^shopify:\/\//, "")
        const name = filePath.split("/").pop() || filePath
        return { original, filePath, name }
      })

    const directEntries: ResolvedEntry[] = urls
      .filter((u) => !u.startsWith("shopify://"))
      .map((original) => ({ original, resolved: original, filename: null }))

    // ── 流式返回 NDJSON：解析出一个就推一个 ────────────────────────────
    // 以前是等全部解析完再一次性返回，于是界面上所有文件一起转到最慢的那
    // 个才变亮 —— 一个 40 个文件、耗时 50 秒的模板，前 49 秒什么都看不到。
    // 现在客户端每收到一行就点亮一个文件。
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (entry: ResolvedEntry) => {
          controller.enqueue(encoder.encode(JSON.stringify(entry) + "\n"))
        }

        try {
          // 本来就可直接使用的 URL 先吐出去，客户端立刻能标记好
          for (const entry of directEntries) emit(entry)

          await resolveShopifyPaths(
            domain,
            accessToken,
            shopifyEntries,
            ({ entry, file, error }) => {
              emit({
                original: entry.original,
                resolved: file?.url ?? null,
                filename: file?.filename ?? null,
                error,
              })
            }
          )
        } catch (err) {
          // 出错也要把已经解析出来的结果留在客户端，所以只记日志、正常收尾；
          // 没拿到的条目由客户端超时兜底（下方兜底逻辑保证每条都会被回调）
          console.error("解析流中断:", err)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        // 关掉反向代理的缓冲，否则流会被攒成一坨再发，等于没流式
        "X-Accel-Buffering": "no",
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "服务器错误" },
      { status: 500 }
    )
  }
}
