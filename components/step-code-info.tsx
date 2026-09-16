"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { IconChevronDown } from "@/components/icons"

interface StepCodeInfoProps {
  templateJson: string | null
  selectedKey: string | null
  sections: string[]
  resolving: boolean
  onViewSection: (key: string) => void
  onViewTemplateJson: () => void
}

export function StepCodeInfo({
  templateJson,
  selectedKey,
  sections,
  resolving,
  onViewSection,
  onViewTemplateJson,
}: StepCodeInfoProps) {
  const [sectionsExpanded, setSectionsExpanded] = useState(false)

  if (!templateJson && sections.length === 0 && !resolving) return null

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="space-y-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
            3
          </span>
          <span className="text-sm font-medium">
            {resolving && !templateJson ? "正在加载模板..." : "模板代码"}
          </span>
          {resolving && !templateJson && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          )}
        </div>

        {resolving && !templateJson ? (
          <div className="space-y-2 pl-10">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-md bg-muted/50"
              />
            ))}
          </div>
        ) : (
          <>
            {/* 模板 JSON */}
            {templateJson && (
              <button
                onClick={onViewTemplateJson}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center">
                    <svg
                      className="h-4 w-4 text-foreground/60"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium">模板 JSON</span>
                  <span className="text-[11px] text-muted-foreground">
                    {selectedKey?.replace(/^templates\//, "")}
                  </span>
                </div>
                <svg
                  className="h-3.5 w-3.5 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" x2="21" y1="14" y2="3" />
                </svg>
              </button>
            )}

            {templateJson && sections.length > 0 && (
              <div className="mx-2 h-px bg-border/50" />
            )}

            {/* Section 列表 */}
            {sections.length > 0 && (
              <div className="space-y-2">
                <button
                  onClick={() => setSectionsExpanded((p) => !p)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center">
                      <svg
                        className="h-4 w-4 text-foreground/60"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium">引用的 Section</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {sections.length}
                    </span>
                  </div>
                  <IconChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                      sectionsExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {sectionsExpanded && (
                  <div className="grid gap-1 pl-2">
                    {sections.map((key) => (
                      <button
                        key={key}
                        onClick={() => onViewSection(key)}
                        className="group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
                      >
                        <span className="text-muted-foreground/50 transition-colors group-hover:text-foreground">
                          <svg
                            className="h-3 w-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                          {key}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
