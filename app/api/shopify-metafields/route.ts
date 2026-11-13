import { NextResponse } from "next/server"
import { sanitizeDomain } from "@/lib/shopify"
import {
  fetchMetafieldDefinitions,
  isSystemMetafieldDef,
  migrateMetafields,
} from "@/lib/metafields"
import type { MetafieldDefinition } from "@/lib/types"

interface ListBody {
  action: "list"
  storeDomain: string
  accessToken: string
}

interface TargetDefsBody {
  action: "target-definitions"
  targetDomain: string
  targetToken: string
}

interface MigrateBody {
  action: "migrate"
  /** 源站点（仅用于把验证项里的元对象定义 GID 按身份重映射） */
  sourceDomain: string
  sourceToken: string
  targetDomain: string
  targetToken: string
  /** 已勾选的元字段定义 */
  definitions: MetafieldDefinition[]
}

/** action 是可辨识字段，用联合而不是交叉（交叉会让 action 塌成 never） */
type RequestBody =
  Partial<ListBody> | Partial<TargetDefsBody> | Partial<MigrateBody>

/**
 * POST /api/shopify-metafields
 *
 * action: "list"    —— 拉取源站点的产品/变体元字段定义（JSON）
 * action: "target-definitions" —— 目标站点已有哪些元字段定义（JSON）
 * action: "migrate" —— 把勾选的定义补建到目标站点（NDJSON 流，**每个定义恰好
 *   一行**）。只迁定义结构，不迁移产品/变体上的字段值
 *
 * 服务端无状态：凭证随每个请求传入，只用于当次调用 Shopify Admin API，
 * 绝不记录 token。迁移流的规则和 shopify-metaobjects 一样：
 * 每个勾选项恰好产生一行结果（失败的也是），否则客户端的 spinner 会一直转。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody

    if (body.action === "list") {
      const { storeDomain, accessToken } = body
      if (!storeDomain || !accessToken) {
        return NextResponse.json({ error: "缺少 API 凭证" }, { status: 400 })
      }

      const defs = await fetchMetafieldDefinitions(
        sanitizeDomain(storeDomain),
        accessToken
      )
      if (defs.error) {
        return NextResponse.json({ error: defs.error }, { status: 502 })
      }

      // 默认只取商家自定义的元字段：shopify 命名空间的标准定义整类排除
      const definitions = defs.definitions.filter(
        (d) => !isSystemMetafieldDef(d)
      )
      return NextResponse.json({ definitions })
    }

    if (body.action === "target-definitions") {
      const { targetDomain, targetToken } = body
      if (!targetDomain || !targetToken) {
        return NextResponse.json({ error: "缺少 API 凭证" }, { status: 400 })
      }

      const defs = await fetchMetafieldDefinitions(
        sanitizeDomain(targetDomain),
        targetToken
      )
      if (defs.error) {
        return NextResponse.json({ error: defs.error }, { status: 502 })
      }

      return NextResponse.json({
        items: defs.definitions.map((d) => ({
          ownerType: d.ownerType,
          namespace: d.namespace,
          key: d.key,
        })),
      })
    }

    if (body.action === "migrate") {
      const {
        sourceDomain,
        sourceToken,
        targetDomain,
        targetToken,
        definitions,
      } = body

      if (!sourceDomain || !sourceToken) {
        return NextResponse.json({ error: "缺少源站点凭证" }, { status: 400 })
      }
      if (!targetDomain || !targetToken) {
        return NextResponse.json({ error: "缺少目标站点凭证" }, { status: 400 })
      }
      if (!definitions || definitions.length === 0) {
        return NextResponse.json(
          { error: "没有要迁移的元字段" },
          { status: 400 }
        )
      }

      // NDJSON 流式响应：每个定义迁移完立刻推送一行
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()

          await migrateMetafields({
            definitions,
            src: {
              domain: sanitizeDomain(sourceDomain),
              token: sourceToken,
            },
            tgt: {
              domain: sanitizeDomain(targetDomain),
              token: targetToken,
            },
            onResult: (result) => {
              controller.enqueue(encoder.encode(JSON.stringify(result) + "\n"))
            },
          })

          controller.close()
        },
      })

      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache",
        },
      })
    }

    return NextResponse.json({ error: "未知的 action" }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "请求失败" },
      { status: 500 }
    )
  }
}
