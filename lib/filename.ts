/**
 * 下载文件名的统一处理。
 *
 * 客户端直接下载、客户端 ZIP 打包、服务端 ZIP 兜底都要用同一套规则，
 * 否则同一个素材在三条路径下会存成不同的名字。
 */

/** 去掉路径分隔符，避免 zip 里出现目录穿越式的条目名 */
export function safeFileName(name: string): string {
  return name.split(/[\\/]/).pop()?.trim() || "file"
}

/**
 * 让扩展名与实际拿到的字节一致。
 *
 * 原始上传是 .mov 而 Shopify 只提供 mp4 转码档时，存成 .mov 会让系统用错程序
 * 打开。URL 的扩展名才反映真实内容，所以以它为准。
 */
export function alignExtension(name: string, url: string): string {
  const segment = url.split("/").pop()?.split("?")[0] ?? ""
  const dotIndex = segment.lastIndexOf(".")

  // 最后一段没有点，说明 URL 里根本没扩展名，保持原名
  if (dotIndex <= 0) return name

  const urlExt = segment.slice(dotIndex + 1).toLowerCase()
  if (!/^[a-z0-9]{2,5}$/.test(urlExt)) return name

  const nameExt = name.split(".").pop()?.toLowerCase() ?? ""
  if (nameExt === urlExt) return name

  return name.includes(".")
    ? `${name.replace(/\.[^.]+$/, "")}.${urlExt}`
    : `${name}.${urlExt}`
}

/** 从 Content-Disposition 中取文件名（优先 RFC 5987 的 filename*） */
export function filenameFromContentDisposition(
  header: string | null
): string | null {
  if (!header) return null

  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      return null
    }
  }

  const plain = header.match(/filename="([^"]+)"/i)
  return plain?.[1] ?? null
}

/**
 * ZIP 里重名会互相覆盖（JSZip 的 file() 是「存在则更新」），
 * 不同目录/不同 URL 的同名素材必须改成 `name (2).ext`。
 */
export function uniqueFileName(name: string, used: Set<string>): string {
  let candidate = name
  let index = 2

  while (used.has(candidate.toLowerCase())) {
    const dot = name.lastIndexOf(".")
    candidate =
      dot > 0
        ? `${name.slice(0, dot)} (${index})${name.slice(dot)}`
        : `${name} (${index})`
    index++
  }

  used.add(candidate.toLowerCase())
  return candidate
}
