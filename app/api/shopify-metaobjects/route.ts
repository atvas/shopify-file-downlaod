import { NextResponse } from "next/server"
import { sanitizeDomain } from "@/lib/shopify"
import {
  fetchAllMetaobjectEntries,
  fetchMetaobjectDefinitions,
  isSystemMetaobjectType,
  migrateMetaobjects,
} from "@/lib/metaobjects"
import type { MetaobjectDefinition, MetaobjectEntry } from "@/lib/types"

interface ListBody {
  action: "list"
  storeDomain: string
  accessToken: string
}

interface MigrateBody {
  action: "migrate"
  sourceDomain: string
  sourceToken: string
  targetDomain: string
  targetToken: string
  definitions: MetaobjectDefinition[]
  entries: MetaobjectEntry[]
  /** true = 只补建缺失的定义，不迁移条目数据 */
  definitionsOnly?: boolean
}

interface TargetDefsBody {
  action: "target-definitions"
  targetDomain: string
  targetToken: string
}

/** action 是可辨识字段，用联合而不是交叉（交叉会让 action 塌成 never） */
type RequestBody =
  Partial<ListBody> | Partial<MigrateBody> | Partial<TargetDefsBody>

/**
 * POST /api/shopify-metaobjects
 *
 * action: "list"    —— 拉取源站点全部元对象定义与条目（JSON）
 * action: "migrate" —— 把勾选的条目迁移到目标站点（NDJSON 流，一条一行）
 * action: "target-definitions" —— 目标站点已有哪些元对象定义类型（JSON）
 *
 * 服务端无状态：凭证随每个请求传入，只用于当次调用 Shopify Admin API，
 * 绝不记录 token。迁移流的规则和 shopify-resolve 一样：
 * **每个条目恰好产生一行结果（失败的也是）**，否则客户端的 spinner 会一直转。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody

    if (body.action === "list") {
      const { storeDomain, accessToken } = body
      if (!storeDomain || !accessToken) {
        return NextResponse.json({ error: "缺少 API 凭证" }, { status: 400 })
      }

      const domain = sanitizeDomain(storeDomain)
      const defs = await fetchMetaobjectDefinitions(domain, accessToken)
      if (defs.error) {
        return NextResponse.json({ error: defs.error }, { status: 502 })
      }

      // 默认只取商家自定义的元对象：shopify-- 前缀的系统/标准定义整类排除，
      // 条目也只按自定义类型枚举 —— 系统类型的条目又多又无关，别拉
      const definitions = defs.definitions.filter(
        (d) => !isSystemMetaobjectType(d.type)
      )

      const entries = await fetchAllMetaobjectEntries(
        domain,
        accessToken,
        definitions.map((d) => d.type)
      )
      if (entries.error) {
        return NextResponse.json({ error: entries.error }, { status: 502 })
      }

      return NextResponse.json({
        definitions,
        entries: entries.entries,
      })
    }

    if (body.action === "target-definitions") {
      const { targetDomain, targetToken } = body
      if (!targetDomain || !targetToken) {
        return NextResponse.json({ error: "缺少 API 凭证" }, { status: 400 })
      }

      const defs = await fetchMetaobjectDefinitions(
        sanitizeDomain(targetDomain),
        targetToken
      )
      if (defs.error) {
        return NextResponse.json({ error: defs.error }, { status: 502 })
      }

      return NextResponse.json({ types: defs.definitions.map((d) => d.type) })
    }

    if (body.action === "migrate") {
      const {
        sourceDomain,
        sourceToken,
        targetDomain,
        targetToken,
        definitions,
        entries,
        definitionsOnly,
      } = body

      if (!sourceDomain || !sourceToken) {
        return NextResponse.json({ error: "缺少源站点凭证" }, { status: 400 })
      }
      if (!targetDomain || !targetToken) {
        return NextResponse.json({ error: "缺少目标站点凭证" }, { status: 400 })
      }
      if (definitionsOnly === true) {
        if (!definitions || definitions.length === 0) {
          return NextResponse.json(
            { error: "没有要迁移的元对象定义" },
            { status: 400 }
          )
        }
      } else if (!entries || entries.length === 0) {
        return NextResponse.json(
          { error: "没有要迁移的元对象" },
          { status: 400 }
        )
      }

      // NDJSON 流式响应：每迁移完一条立刻推送一行
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()

          await migrateMetaobjects({
            definitions: definitions ?? [],
            entries: entries ?? [],
            definitionsOnly,
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
