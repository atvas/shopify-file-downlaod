import { NextResponse } from "next/server"
import { sanitizeDomain, SHOPIFY_API_VERSION } from "@/lib/shopify"

interface RequestBody {
  storeDomain: string
  accessToken: string
  action: "list-themes" | "list-templates" | "get-template"
  themeId?: number
  key?: string
}

async function shopifyFetch(
  domain: string,
  accessToken: string,
  path: string
) {
  return fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}${path}`, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody
    const { storeDomain, accessToken, action } = body

    if (!storeDomain || !accessToken) {
      return NextResponse.json({ error: "缺少 API 凭证" }, { status: 400 })
    }

    const domain = sanitizeDomain(storeDomain)

    switch (action) {
      // ── 主题列表 ──────────────────────────────────────────────
      case "list-themes": {
        const res = await shopifyFetch(domain, accessToken, "/themes.json")
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          return NextResponse.json(
            { error: `获取主题失败 (${res.status}): ${text}` },
            { status: res.status }
          )
        }
        const data = await res.json()
        const themes = (data.themes ?? []).map(
          (t: { id: number; name: string; role: string }) => ({
            id: t.id,
            name: t.name,
            role: t.role,
          })
        )
        return NextResponse.json({ themes })
      }

      // ── 模板/资源列表 ────────────────────────────────────────
      case "list-templates": {
        const { themeId } = body
        if (!themeId) {
          return NextResponse.json(
            { error: "缺少 themeId" },
            { status: 400 }
          )
        }

        const res = await shopifyFetch(
          domain,
          accessToken,
          `/themes/${themeId}/assets.json`
        )
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          return NextResponse.json(
            { error: `获取资源列表失败 (${res.status}): ${text}` },
            { status: res.status }
          )
        }
        const data = await res.json()
        const keys: string[] = (data.assets ?? [])
          .map((a: { key: string }) => a.key)
          .filter(
            (key: string) =>
              key.startsWith("templates/") || key.startsWith("sections/")
          )
          .filter((key: string) => key.endsWith(".json"))

        return NextResponse.json({ keys })
      }

      // ── 单个模板内容 ─────────────────────────────────────────
      case "get-template": {
        const { themeId, key } = body
        if (!themeId || !key) {
          return NextResponse.json(
            { error: "缺少 themeId 或 key" },
            { status: 400 }
          )
        }

        const params = new URLSearchParams({ "asset[key]": key })
        const res = await shopifyFetch(
          domain,
          accessToken,
          `/themes/${themeId}/assets.json?${params}`
        )
        if (!res.ok) {
          const text = await res.text().catch(() => "")
          return NextResponse.json(
            { error: `获取模板内容失败 (${res.status}): ${text}` },
            { status: res.status }
          )
        }
        const data = await res.json()
        const value = data.asset?.value ?? null

        if (!value) {
          return NextResponse.json(
            { error: "模板内容为空" },
            { status: 404 }
          )
        }

        return NextResponse.json({ content: value })
      }

      default:
        return NextResponse.json(
          { error: `未知操作: ${action}` },
          { status: 400 }
        )
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "服务器错误" },
      { status: 500 }
    )
  }
}
