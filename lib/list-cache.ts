/**
 * 列表数据的会话内缓存（内存级，路由间跳转有效）：
 * 同一源店铺再次进入页面时先展示缓存、再静默刷新（stale-while-revalidate）。
 *
 * 刻意不落 localStorage —— 元对象条目可能非常大，配额和过期风险都不值当；
 * 整页刷新后重新拉一次是可接受的代价。
 */

const cache = new Map<string, unknown>()

export function readListCache<T>(key: string): T | null {
  return (cache.get(key) as T | undefined) ?? null
}

export function writeListCache(key: string, value: unknown): void {
  cache.set(key, value)
}
