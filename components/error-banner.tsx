"use client"

interface ErrorBannerProps {
  error: string
}

export function ErrorBanner({ error }: ErrorBannerProps) {
  if (!error) return null

  return (
    <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 backdrop-blur-sm">
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" x2="12" y1="8" y2="12" />
        <line x1="12" x2="12.01" y1="16" y2="16" />
      </svg>
      <p className="whitespace-pre-wrap text-sm text-destructive">{error}</p>
    </div>
  )
}
