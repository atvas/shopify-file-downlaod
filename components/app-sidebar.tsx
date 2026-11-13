"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { BoxesIcon, DownloadIcon, StoreIcon, TagsIcon } from "lucide-react"

const NAV_ITEMS = [
  { href: "/", label: "素材下载", icon: DownloadIcon },
  { href: "/metaobjects", label: "元对象迁移", icon: BoxesIcon },
  { href: "/metafields", label: "产品元字段", icon: TagsIcon },
  { href: "/config", label: "店铺配置", icon: StoreIcon },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link href="/config" />}
            >
              {/* <CommandIcon className="size-5!" /> */}
              <span className="text-lg font-semibold">Shopify Tool</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.label}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* <SidebarFooter>
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <StoreIcon className="size-4 shrink-0" />
          {source ? (
            <span className="min-w-0">
              <span className="block truncate text-foreground/80">
                {source.name}
              </span>
              <span className="block truncate">{source.domain}</span>
            </span>
          ) : (
            <span>未配置源店铺</span>
          )}
        </div>
      </SidebarFooter> */}
    </Sidebar>
  )
}
