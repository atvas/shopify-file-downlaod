"use client"

import { useState } from "react"
import { MetafieldMigration } from "@/components/metafield-migration"
import { ErrorBanner } from "@/components/error-banner"
import { useMounted } from "@/hooks/use-mounted"
import { getCurrentSource, getCurrentTarget } from "@/lib/stores"

/**
 * 产品元字段管理。
 * 列出源站点产品/变体元字段定义，勾选后在目标站点创建对应定义（只迁结构）。
 * 凭证来自店铺配置页（/config）的「当前源 / 当前目标」，页面本身不放配置控件。
 */
export default function MetafieldsPage() {
  const mounted = useMounted()
  const [error, setError] = useState("")
  const [source] = useState(() => getCurrentSource())
  const [target] = useState(() => getCurrentTarget())

  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
      {/* 产品 / 变体元字段迁移（凭证 = 当前源 / 当前目标） */}
      <MetafieldMigration
        storeDomain={source?.domain ?? ""}
        accessToken={source?.token ?? ""}
        targetDomain={target?.domain ?? ""}
        targetToken={target?.token ?? ""}
        onError={setError}
      />

      {/* 错误提示 */}
      <ErrorBanner error={error} />
    </div>
  )
}
