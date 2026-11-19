"use client"

import { useState } from "react"
import { IconChevronDown } from "@/components/icons"
import { type SectionRef } from "@/lib/parse"

interface TemplateInfoProps {
  templateJson: string | null
  selectedKey: string | null
  sections: SectionRef[]
  resolving: boolean
  onViewSection: (key: string) => void
  onViewTemplateJson: () => void
}

/**
 * 模板信息面板 —— 从原来的「步骤 2」合并进步骤 1。
 * 模板 JSON / Section 属于辅助信息，不该占一张独立卡片、也不该算一步。
 */
export function TemplateInfo({
  templateJson,
  selectedKey,
  sections,
  resolving,
  onViewSection,
  onViewTemplateJson,
}: TemplateInfoProps) {
  const [expanded, setExpanded] = useState(false)

  if (!templateJson && sections.length === 0) {
    return resolving ? (
      <div className="h-11 animate-pulse rounded-xl bg-[#F6F7F9] dark:bg-muted/40" />
    ) : null
  }

  return (
    <div className="overflow-hidden rounded-xl bg-[#F6F7F9] dark:bg-muted/40">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#EFF1F4] dark:hover:bg-muted/60"
      >
        <svg
          className="h-4 w-4 shrink-0 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="shrink-0 text-xs font-medium">模板信息</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/60">
          {selectedKey?.replace(/^templates\//, "") ?? ""}
        </span>
        {sections.length > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {sections.length} 个 Section
          </span>
        )}
        <IconChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="space-y-1 bg-white/70 px-2 py-2 dark:bg-background/30">
          {templateJson && (
            <button
              type="button"
              onClick={onViewTemplateJson}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
            >
              <svg
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              <span className="text-xs">查看模板 JSON</span>
              <span className="ml-auto text-[10px] text-muted-foreground/50">
                打开
              </span>
            </button>
          )}

          {sections.length > 0 && (
            <div className="space-y-0.5">
              <p className="px-2.5 pt-1 pb-0.5 text-[10px] tracking-wide text-muted-foreground/50 uppercase">
                引用的 Section
              </p>
              {sections.map((section) => (
                <button
                  key={section.path}
                  type="button"
                  onClick={() => onViewSection(section.path)}
                  className={`group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50 ${
                    section.disabled ? "opacity-50" : ""
                  }`}
                >
                  <span className="truncate font-mono text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
                    {section.path}
                  </span>
                  {section.disabled && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      未启用
                    </span>
                  )}
                  <svg
                    className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
