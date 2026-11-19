/**
 * 读取 `Response` 的整个 body，同时按字节上报进度。
 *
 * Content-Length 已知时直接预分配，边读边写；不能「先攒 chunks 再合并」，
 * 那样单个视频会在内存里短暂占两份，并发下载时会被放大好几倍。
 */
export async function readResponseBody(
  response: Response,
  onProgress?: (received: number, total: number) => void
): Promise<ArrayBuffer> {
  const total = Number(response.headers.get("content-length") ?? 0) || 0
  onProgress?.(0, total)

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onProgress?.(buffer.byteLength, buffer.byteLength)
    return buffer
  }

  const reader = response.body.getReader()
  let received = 0

  let merged: Uint8Array<ArrayBuffer> | null =
    total > 0 ? new Uint8Array(total) : null
  const overflow: Uint8Array[] = []

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    if (merged) {
      if (received + value.byteLength <= merged.byteLength) {
        merged.set(value, received)
      } else {
        // 实际字节数超过头部声明（例如压缩传输），退回 chunk 列表
        overflow.push(merged.subarray(0, received), value)
        merged = null
      }
    } else {
      overflow.push(value)
    }

    received += value.byteLength
    onProgress?.(received, total)
  }

  let buffer: ArrayBuffer
  if (merged) {
    buffer =
      received === merged.byteLength
        ? merged.buffer
        : merged.buffer.slice(0, received)
  } else {
    const all = new Uint8Array(received)
    let offset = 0
    for (const chunk of overflow) {
      all.set(chunk, offset)
      offset += chunk.byteLength
    }
    buffer = all.buffer
  }

  onProgress?.(received, total > 0 ? total : received)
  return buffer
}
