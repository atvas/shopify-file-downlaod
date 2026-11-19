/**
 * 限制并发数。
 *
 * 放在独立模块里，客户端组件也能直接使用 —— `lib/shopify.ts` 只应留在
 * 服务端，客户端为了一个 10 行的并发函数把整套解析逻辑打进 bundle 不值得。
 */

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await fn(items[index])
      }
    }
  )

  await Promise.all(workers)
  return results
}
