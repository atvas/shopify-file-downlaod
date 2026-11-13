"use client"

import { useState } from "react"
import { StoreConfigPanel } from "@/components/store-config"
import { ErrorBanner } from "@/components/error-banner"
import { useMounted } from "@/hooks/use-mounted"

/**
 * 店铺配置：统一店铺列表 + 「当前源 / 当前目标」指针。
 * 业务页面不放配置控件，直接消费这里的当前指针。
 */
export default function ConfigPage() {
  const mounted = useMounted()
  const [error, setError] = useState("")

  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <StoreConfigPanel onError={setError} />
      <ErrorBanner error={error} />
    </div>
  )
}
