import type { ReactNode } from "react"

/**
 * 步骤卡片共用的头部：轻量步骤号 + 标题 + 副标题 + 右侧状态/操作。
 * 之前每个卡片各写一套，字号、内边距和步骤圆点大小都不一样。
 */
export function StepHeader({
  step,
  title,
  subtitle,
  actions,
}: {
  step: number
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-foreground/60">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] leading-5 font-semibold tracking-tight">
            {title}
          </h2>
          {subtitle && (
            <div className="mt-1.5 text-xs text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  )
}
