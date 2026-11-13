"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useMounted } from "@/hooks/use-mounted"
import { getCurrentSource, getCurrentTarget } from "@/lib/stores"

/** 路由 → 页面标题（匹配不上的回落到素材下载） */
const TITLES: [string, string][] = [
  ["/metaobjects", "元对象迁移"],
  ["/metafields", "产品元字段"],
  ["/config", "店铺配置"],
]

function titleOf(pathname: string): string {
  for (const [prefix, title] of TITLES) {
    if (pathname.startsWith(prefix)) return title
  }
  return "素材下载"
}

export function SiteHeader() {
  const pathname = usePathname()
  const mounted = useMounted()
  // 源 / 目标店铺：挂载后再读 localStorage，避免 SSR 不一致
  const source = mounted ? getCurrentSource() : null
  const target = mounted ? getCurrentTarget() : null

  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/70 backdrop-blur-xl transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 h-4 data-vertical:self-auto"
        />
        <h1 className="text-base font-medium">{titleOf(pathname)}</h1>

        {/* 源 / 目标店铺（右侧） */}
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2 py-1"
            title={
              source
                ? `源店铺：${source.name}（${source.domain}）`
                : "未设置源店铺"
            }
          >
            <span className="text-[10px] font-medium text-primary">源</span>
            <span className="max-w-[12ch] truncate text-xs text-muted-foreground">
              {source?.name ?? "未设置"}
            </span>
          </span>
          <span
            className="flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2 py-1"
            title={
              target
                ? `目标店铺：${target.name}（${target.domain}）`
                : "未设置目标店铺"
            }
          >
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              目标
            </span>
            <span className="max-w-[12ch] truncate text-xs text-muted-foreground">
              {target?.name ?? "未设置"}
            </span>
          </span>
          <Link
            href="/config"
            className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            更改
          </Link>
        </div>
      </div>
    </header>
  )
}
