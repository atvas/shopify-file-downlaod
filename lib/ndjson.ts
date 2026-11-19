/**
 * 逐行读取 NDJSON 响应。
 *
 * 解析、推送、目标检查三个接口都按「一行一个 JSON」流式返回，
 * 这里统一处理分块解码、断行拼接和坏行跳过。
 */
export async function readNdjson<T>(
  response: Response,
  onItem: (item: T) => void
): Promise<void> {
  if (!response.body) throw new Error("响应没有内容")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  const consume = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      onItem(JSON.parse(trimmed) as T)
    } catch {
      // 跳过坏行，不中断整个流
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) consume(line)
  }

  consume(buffer)
}
