"use client"

import type { MediaFile } from "@/lib/types"
import { IconVideo, IconImage } from "@/components/icons"
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "@/components/ui/dialog"

export function PreviewDialog({
  file,
  previewUrl,
  onClose,
}: {
  file: MediaFile | null
  previewUrl: string | null
  onClose: () => void
}) {
  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="gap-0 overflow-hidden border-0 bg-card p-0 shadow-2xl sm:max-w-5xl"
        showCloseButton={false}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-border/50 bg-card/80 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                file?.type === "video"
                  ? "bg-blue-500/10 text-blue-500"
                  : "bg-emerald-500/10 text-emerald-500"
              }`}
            >
              {file?.type === "video" ? (
                <IconVideo className="h-3 w-3" />
              ) : (
                <IconImage className="h-3 w-3" />
              )}
            </span>
            <span className="truncate text-xs font-medium text-foreground/80">
              {file?.name}
            </span>
          </div>
          <DialogClose
            render={
              <button className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground" />
            }
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </DialogClose>
        </div>

        {/* 媒体内容 */}
        <div className="flex items-center justify-center bg-black/[0.03] dark:bg-white/[0.03]">
          {previewUrl ? (
            file?.type === "video" ? (
              <video
                src={previewUrl}
                controls
                autoPlay
                className="max-h-[80vh] w-full object-contain"
              />
            ) : (
              <img
                src={previewUrl}
                alt={file?.name}
                className="max-h-[80vh] w-full object-contain"
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 py-20 text-muted-foreground/50">
              {file?.type === "video" ? (
                <IconVideo className="h-8 w-8" />
              ) : (
                <IconImage className="h-8 w-8" />
              )}
              <span className="text-xs">无法加载</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
