export { cn } from "cn"

/** 文件大小的人类可读形式：12.3 MB / 640 KB */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ""

  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
