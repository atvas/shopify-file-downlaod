/**
 * Shopify Admin API 共用的文件解析逻辑。
 *
 * 两个路由（shopify-resolve / shopify-videos）都依赖这里的匹配与选源判定。
 * 这两处曾经各自维护了一份拷贝，一起写错了同一个 bug —— 所以统一放这里，
 * 只保留唯一一份实现。
 */

export const SHOPIFY_API_VERSION = "2024-01"

export interface VideoSource {
  url: string | null
  mimeType: string | null
  format: string | null
  width: number | null
  height: number | null
  fileSize: number | null
}

/** GraphQL `files` 查询返回的节点（只在 File 接口上取公共字段） */
export interface FileNode {
  alt?: string | null
  /** 仅 Video 上有；图片没有这个字段 */
  filename?: string | null
  /** 仅 Video 上有；非 READY 时 sources / originalSource 都是空的 */
  status?: string | null
  /** 仅 MediaImage 上有 */
  image?: { url: string | null } | null
  /** 仅 GenericFile 上有（.pdf/.zip 这类） */
  url?: string | null
  originalSource?: VideoSource | null
  sources?: VideoSource[] | null
}

export interface ResolvedFile {
  url: string
  /** 原始文件名，用于给下载的文件命名 */
  filename: string | null
}

export interface ResolveResult {
  url: string | null
  filename: string | null
  errors: string[]
}

type FilesQueryResult =
  | { ok: true; nodes: FileNode[] }
  | { ok: false; accessDenied: true; requiredScopes: string }
  | { ok: false; accessDenied: false }

// `filename` / `status` 只能放在 `... on Video` 里 —— **别提到 nodes 层级**。
// `File` 接口只有 alt / createdAt / fileErrors / fileStatus / id / preview /
// updatedAt 七个字段，没有 filename。写在接口作用域上会让 GraphQL 校验直接
// 拒绝整条查询，于是全部退到 REST + HEAD 兜底，比不批量还慢。
//
// 用 `nodes` 而不是 `edges { node }`：少一层包装，payload 更小。
const FILE_NODE_FIELDS = `
  nodes {
    alt
    ... on MediaImage {
      image {
        url
      }
    }
    ... on Video {
      filename
      status
      originalSource {
        url
        mimeType
        format
        width
        height
      }
      sources {
        url
        mimeType
        format
        width
        height
        fileSize
      }
    }
    ... on GenericFile {
      url
    }
  }
`

// first 走变量：批量搜索一批名字时取「这批名字的个数」，单个解析时取小值。
// 成本按**请求的对象数**计费，所以不要一律往大了取。
const FILES_QUERY = `
  query GetFiles($query: String!, $first: Int!) {
    files(first: $first, query: $query) {${FILE_NODE_FIELDS}}
  }
`

/** 去掉协议与结尾斜杠，得到 GraphQL 端点用的裸域名 */
export function sanitizeDomain(storeDomain: string): string {
  return storeDomain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
}

/** Shopify 会返回 `//store.myshopify.com/...` 这种协议相对 URL */
export function normalizeUrl(url: string): string {
  return url.startsWith("//") ? `https:${url}` : url
}

function isPlaylist(source: VideoSource): boolean {
  const format = (source.format ?? "").toLowerCase()
  const mimeType = (source.mimeType ?? "").toLowerCase()
  return (
    format === "m3u8" ||
    mimeType.includes("mpegurl") ||
    (source.url ?? "").toLowerCase().includes(".m3u8")
  )
}

/**
 * 选出该视频最合适的下载地址。
 *
 * 用户选定：最高画质 MP4 转码版。`sources` 里除了各档 mp4，还混着 Shopify
 * 自动生成的 m3u8（HLS 播放列表）—— 那是个几 KB 的文本清单，直接下下来
 * 既播不了也不是视频。所以这里必须把它滤掉，再按分辨率取最高档。
 */ 
export function pickBestVideoSource(node: FileNode): string | null {
  const usable = (node.sources ?? []).filter(
    (source) => !!source.url && !isPlaylist(source)
  )

  if (usable.length > 0) {
    const best = [...usable].sort((a, b) => {
      const aSize = a.height ?? a.width ?? 0
      const bSize = b.height ?? b.width ?? 0
      if (aSize !== bSize) return bSize - aSize
      return (b.fileSize ?? 0) - (a.fileSize ?? 0)
    })[0]
    if (best.url) return best.url
  }

  // 没有可用的转码档时退回原始上传文件
  return node.originalSource?.url ?? null
}

/** 该节点可以直接下载的 URL：视频走最优转码档，图片走 image，其他走 url */
export function nodeDownloadUrl(node: FileNode): string | null {
  if (node.image?.url) return node.image.url
  if (node.url) return node.url
  return pickBestVideoSource(node)
}

/** decodeURIComponent 遇到残缺的 % 转义会抛，兜住 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 判断一个 GraphQL 节点是否就是我们要找的文件。
 *
 * 视频的 CDN URL 形如
 *   /cdn/shop/videos/c/vp/<hash>/<hash>.HD-1080p-7.2Mbps.mp4
 * 文件名位置是哈希，**不含原始文件名**，所以视频只能靠 `Video.filename` 比对。
 * URL 比对是留给图片/其他类型的 —— 它们的 CDN URL 会保留文件名。
 *
 * 这里刻意只做**精确**比对，不做 `includes` 模糊匹配：批量查询会把整个 chunk
 * 的节点一起返回，模糊匹配会让 A 的节点被 B 的名字认领走，解析出错误的文件 ——
 * 比解析不出来更糟。命中率不够时靠第二轮兜底，那一轮现在是批量的、很便宜。
 */
export function nodeMatches(node: FileNode, fileName: string): boolean {
  const target = fileName.trim().toLowerCase()
  if (!target) return false

  const nodeFileName = (node.filename ?? "").trim().toLowerCase()
  if (nodeFileName && nodeFileName === target) return true

  const alt = (node.alt ?? "").trim().toLowerCase()
  if (alt && alt === target) return true

  // 必须**解码后**再比：CDN 会把空格转义成 %20，不解码的话
  // `hero image.png` 这类带空格的名字永远匹配不上，被误判成"找不到"。
  const url = nodeDownloadUrl(node)
  if (url && safeDecode(url).toLowerCase().includes(target)) return true

  return false
}

/**
 * 搜索词一律加引号并转义。
 *
 * 不加引号时 `filename:must watch-2.mp4` 会被搜索解析器读成 `filename:must`
 * 外加一段自由文本；文件名里的 `-` 还可能被当成否定符。无论如何都加引号，
 * 两种情况一并避免。
 */
function quoteSearchTerm(term: string): string {
  return `"${term.replace(/["\\]/g, "\\$&")}"`
}

/** 由精确到宽松排列的候选搜索词 */
export function buildSearchQueries(fileName: string): string[] {
  const stem = fileName.replace(/\.[^.]+$/, "")
  const queries = [`filename:${quoteSearchTerm(fileName)}`]

  if (stem && stem !== fileName) {
    queries.push(`filename:${quoteSearchTerm(stem)}`)
  }
  queries.push(quoteSearchTerm(fileName))

  return [...new Set(queries)]
}

type GraphQLResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; accessDenied: true; requiredScopes: string }
  | { ok: false; accessDenied: false }

/** 发一个 GraphQL 请求并统一处理错误（尤其是权限不足） */
async function postGraphQL(
  domain: string,
  accessToken: string,
  body: { query: string; variables: Record<string, unknown> }
): Promise<GraphQLResult> {
  try {
    const response = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) return { ok: false, accessDenied: false }

    const payload = await response.json()

    if (payload.errors) {
      const denied = payload.errors.find(
        (e: { extensions?: { code?: string } }) =>
          e.extensions?.code === "ACCESS_DENIED"
      )
      if (denied) {
        return {
          ok: false,
          accessDenied: true,
          requiredScopes: denied.extensions?.requiredAccess ?? "",
        }
      }
      return { ok: false, accessDenied: false }
    }

    return { ok: true, data: payload.data ?? {} }
  } catch {
    return { ok: false, accessDenied: false }
  }
}

function connectionNodes(connection: unknown): FileNode[] {
  return (connection as { nodes?: FileNode[] } | undefined)?.nodes ?? []
}

async function queryFiles(
  domain: string,
  accessToken: string,
  searchQuery: string,
  first: number
): Promise<FilesQueryResult> {
  const result = await postGraphQL(domain, accessToken, {
    query: FILES_QUERY,
    variables: { query: searchQuery, first },
  })
  if (!result.ok) return result

  return { ok: true, nodes: connectionNodes(result.data.files) }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * 限制并发数。
 *
 * 一个模板里可能有几十个素材，每个还要试 3 个搜索词 —— 不设上限就是几百个
 * 请求同时打过去，必然触发 Shopify 的 leaky bucket 限流，表现为「部分视频
 * 时好时坏」这种最难查的症状。
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

/** 顺序单查时的并发数。只用于单个文件的完整解析。 */
const BATCH_CONCURRENCY = 6

/** `files` 连接的 first 上限 */
const MAX_PAGE_SIZE = 250

/** 单个文件精确解析时取几条候选 */
const SINGLE_PAGE_SIZE = 5

/** 同时在飞的批量请求数。每个请求里已经装了多条查询，别叠太多。 */
const BATCH_REQUEST_CONCURRENCY = 6

/**
 * 每个 alias 取多少条。
 *
 * filename 查询通常只命中 1 个文件，取 10 足够覆盖偶尔的重名；
 * 不直接取 250 —— 成本按**请求的对象数**计费，取大了纯属浪费。
 */
const ALIAS_PAGE_SIZE = 10

/**
 * 一条 GraphQL 请求里放多少个别名。
 *
 * 超过这个数就拆成多条请求。别太大：Shopify 有查询复杂度上限，20 个别名
 * 各取 10 条 = 200 个对象，远低于上限；再大就有被拒的风险了。
 */
const ALIAS_CHUNK_SIZE = 20

/**
 * 批量解析。两轮，**两轮都是批量的**：
 *
 *   1. 按 `ALIAS_CHUNK_SIZE` 个一组，用 GraphQL 别名拼成一条请求：
 *      每个文件名对应一个别名 `f0: files(first: 10, query: "filename:X") { ... }`，
 *      多个别名合进同一条 GraphQL 请求。40 个素材 = 1 次往返。
 *   2. 第一轮没命中的，去掉扩展名再批量搜一轮。
 *
 * 用别名而非 OR：OR 把所有结果混在同一个列表里，匹配靠 nodeMatches 兜底；
 * 别名让每个文件名拿到自己独立的结果集，从根本上避免跨文件误匹配。
 * 含中文、特殊字符的文件名也不再依赖 Shopify 搜索对 OR 的解析能力。
 *
 * 真正难啃的漏网之鱼由 `resolveShopifyPaths` 的 REST + CDN 兜底接住。
 */
export async function batchResolve(
  domain: string,
  accessToken: string,
  fileNames: string[],
  onResolved?: (name: string, file: ResolvedFile) => void
): Promise<Map<string, ResolvedFile>> {
  const uniqueNames = [...new Set(fileNames)]
  const resolved = new Map<string, ResolvedFile>()
  if (uniqueNames.length === 0) return resolved

  /**
   * 每个别名的结果只属于那个文件名，不存在节点争抢，但保留去重以防
   * 同一个名字在不同轮次（完整名 vs 去扩展名）被重复处理。
   */
  const claimFromAlias = (
    name: string,
    nodes: FileNode[]
  ) => {
    if (resolved.has(name)) return

    for (const node of nodes) {
      if (!nodeMatches(node, name)) continue

      const url = nodeDownloadUrl(node)
      if (!url) continue

      const file = {
        url: normalizeUrl(url),
        filename: node.filename ?? null,
      }
      resolved.set(name, file)
      onResolved?.(name, file)
      return
    }
  }

  /**
   * 用 GraphQL 别名把一批文件名拼成一条请求发出去。
   *
   * 每个文件名对应一个独立的 `files` 查询（别名 `f0`、`f1`…），
   * 各自的结果集互不干扰，响应回来后逐个别名认领并上报。
   * 查询失败时**对半劈开重试**，避免整批丢失。
   */
  const askChunk = async (chunk: string[]): Promise<void> => {
    const fields = chunk
      .map((fileName, i) => {
        const alias = `f${i}`
        return `
          ${alias}: files(first: ${ALIAS_PAGE_SIZE}, query: ${quoteSearchTerm(`filename:${quoteSearchTerm(fileName)}`)}) {
            ${FILE_NODE_FIELDS}
          }
        `
      })
      .join("\n")

    const query = `query { ${fields} }`

    const result = await postGraphQL(domain, accessToken, {
      query,
      variables: {},
    })

    if (!result.ok) {
      if (chunk.length > 1) {
        const mid = Math.ceil(chunk.length / 2)
        console.warn(
          `[shopify] 一条 ${chunk.length} 个别名查询失败，拆成两半重试`
        )
        await askChunk(chunk.slice(0, mid))
        await askChunk(chunk.slice(mid))
      }
      return
    }

    const data = result.data as Record<string, { nodes?: FileNode[] }>
    chunk.forEach((fileName, i) => {
      const alias = `f${i}`
      const nodes = connectionNodes(data[alias])
      claimFromAlias(fileName, nodes)
    })
  }

  /**
   * 把搜索词按 ALIAS_CHUNK_SIZE 分组问出去。**每落地一批就立刻认领并上报**，
   * 而不是等所有分组都回来再统一处理 —— 客户端要靠这个把文件一个个点亮，
   * 否则要一直等到最慢的那一批，前面等的时间全是白等。
   */
  const searchAndClaim = async (terms: string[]) => {
    const batches = chunkArray(terms, ALIAS_CHUNK_SIZE)
    const startedAt = Date.now()

    await mapWithConcurrency(batches, BATCH_REQUEST_CONCURRENCY, (chunk) =>
      askChunk(chunk)
    )

    console.log(
      `[shopify] 别名批量搜索 ${terms.length} 项 / ${batches.length} 批，` +
        `耗时 ${Date.now() - startedAt}ms`
    )
  }

  // ── 第一轮：完整文件名 ─────────────────────────────────────────────
  await searchAndClaim(uniqueNames)

  const misses = uniqueNames.filter((name) => !resolved.has(name))
  if (misses.length === 0) return resolved

  // ── 第二轮：去掉扩展名再批量搜一轮 ─────────────────────────────────
  // 主名太短（比如 "a"）会匹配到一大堆无关文件，跳过。
  const stems = [
    ...new Set(
      misses
        .map((name) => name.replace(/\.[^.]+$/, ""))
        .filter((stem) => stem.length >= 3)
    ),
  ]
  if (stems.length === 0) return resolved

  await searchAndClaim(stems)

  return resolved
}

/** REST /files.json 兜底查找 */
async function tryRestLookup(
  domain: string,
  accessToken: string,
  fileName: string
): Promise<{ file: ResolvedFile | null; error?: string }> {
  try {
    const response = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/files.json?limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    )

    if (response.status === 403) {
      return {
        file: null,
        error:
          "REST API 权限不足，需要 `read_files` 或 `read_content` 权限范围。",
      }
    }
    if (!response.ok) return { file: null }

    const data = await response.json()
    const target = fileName.toLowerCase()

    for (const file of data.files ?? []) {
      const url = file.url ?? ""
      if (!url) continue

      const alt = (file.alt ?? "").toLowerCase()
      const name = (file.filename ?? file.name ?? "").toLowerCase()

      if (
        alt === target ||
        name === target ||
        url.toLowerCase().includes(target)
      ) {
        return {
          file: { url: normalizeUrl(url), filename: file.filename ?? null },
        }
      }
    }
    return { file: null }
  } catch {
    return { file: null }
  }
}

/** 直接拼 CDN 路径并 HEAD 探测 */
async function tryCdnProbe(
  domain: string,
  filePath: string,
  fileName: string
): Promise<ResolvedFile | null> {
  // 空格只能用 %20：URL 的 path 里 `+` 是字面加号，不是空格，拼出来必然 404
  const encodedName = encodeURIComponent(fileName)
  const candidates = [
    `https://${domain}/cdn/shop/files/${encodedName}`,
    `https://${domain}/cdn/shop/${filePath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  ]

  for (const candidate of [...new Set(candidates)]) {
    try {
      const response = await fetch(candidate, { method: "HEAD" })
      if (!response.ok) continue

      // 确认返回的不是 HTML 错误页
      const contentType = response.headers.get("content-type") ?? ""
      if (contentType.includes("text/html")) continue

      return { url: candidate, filename: null }
    } catch {
      // 试下一个
    }
  }
  return null
}

export interface ResolveOptions {
  /**
   * 调用方（`batchResolve`）已经跑过同一批 GraphQL 搜索了，跳过以免重复发请求。
   * 失败路径上最大的一笔浪费就是这里 —— 同一个文件名被搜两遍。
   */
  skipGraphQL?: boolean
}

/**
 * 完整解析单个 `shopify://` 文件路径。三级策略：
 *   1. GraphQL filename 搜索（快，且现在能正确匹配视频）
 *   2. REST /files.json（老接口兜底）
 *   3. 直接拼 CDN 路径并 HEAD 探测
 *
 * 策略 2 和 3 互不依赖，并发跑、谁先成功用谁。
 */
export async function resolveShopifyFileUrl(
  domain: string,
  accessToken: string,
  filePath: string,
  options: ResolveOptions = {}
): Promise<ResolveResult> {
  const errors: string[] = []
  const fileName = filePath.split("/").pop() || filePath

  // ── 策略 1: GraphQL ────────────────────────────────────────────────
  if (!options.skipGraphQL) {
    let matchedButNotReady: string | null = null

    for (const searchQuery of buildSearchQueries(fileName)) {
      const result = await queryFiles(
        domain,
        accessToken,
        searchQuery,
        SINGLE_PAGE_SIZE
      )

      if (!result.ok) {
        if (result.accessDenied) {
          errors.push(
            `API 权限不足: ${result.requiredScopes}. ` +
              `请在 Shopify 后台为 App 添加这些权限范围(scope)。`
          )
          break // 权限问题对所有查询都一样，无需重试
        }
        continue
      }

      for (const node of result.nodes) {
        if (!nodeMatches(node, fileName)) continue

        const url = nodeDownloadUrl(node)
        if (url) {
          return {
            url: normalizeUrl(url),
            filename: node.filename ?? null,
            errors: [],
          }
        }

        // 匹配上了但拿不到地址 —— 视频多半还在转码
        if (node.status && node.status !== "READY") {
          matchedButNotReady = node.status
        }
      }
    }

    if (matchedButNotReady) {
      return {
        url: null,
        filename: null,
        errors: [
          `视频 "${fileName}" 仍在 Shopify 转码中（status: ${matchedButNotReady}），` +
            `转码完成后即可解析。`,
        ],
      }
    }

    if (errors.length > 0) {
      return { url: null, filename: null, errors }
    }
  }

  // ── 策略 2 + 3: 并发跑 ─────────────────────────────────────────────
  // REST 要拉 250 个文件、CDN 要发 HEAD，串行的话失败路径白白叠加两段延迟。
  const [rest, cdn] = await Promise.all([
    tryRestLookup(domain, accessToken, fileName),
    tryCdnProbe(domain, filePath, fileName),
  ])

  if (rest.file) return { ...rest.file, errors: [] }
  if (cdn) return { ...cdn, errors: [] }
  if (rest.error) errors.push(rest.error)

  errors.push(
    `无法解析 shopify:// 文件路径 "${filePath}"。` +
      `GraphQL 按文件名未找到匹配，直接访问 CDN 也失败。` +
      `请确认文件确实存在于 Shopify 后台 > Content > Files，` +
      `且 API Token 包含 read_files 权限范围(scope)。`
  )

  return { url: null, filename: null, errors }
}

export interface ShopifyPathEntry {
  /** 原始的 `shopify://` URL，仅原样带回给调用方 */
  original: string
  filePath: string
  name: string
}

export interface ShopifyPathOutcome {
  entry: ShopifyPathEntry
  file: ResolvedFile | null
  error?: string
}

/**
 * 两阶段解析一批 `shopify://` 路径，两个阶段都限并发：
 *   1. `batchResolve` —— GraphQL 用 OR 批量搜索（两轮）
 *   2. 未命中的走完整解析兜底（GraphQL 已试过，跳过）
 *
 * 阶段 2 以前是不限并发的 `Promise.all`：几十个文件没命中时会把上百个请求
 * 一次全抛出去，触发限流，结果比串行还慢。
 *
 * `onOutcome` 每个条目**恰好回调一次**（成功的走批量那两轮，失败的走兜底），
 * 供调用方流式转发给客户端。失败的条目也必须回调 —— 漏掉的话客户端会一直转圈。
 */
export async function resolveShopifyPaths(
  domain: string,
  accessToken: string,
  entries: ShopifyPathEntry[],
  onOutcome?: (outcome: ShopifyPathOutcome) => void
): Promise<ShopifyPathOutcome[]> {
  const byOriginal = new Map<string, ShopifyPathOutcome>()

  const report = (outcome: ShopifyPathOutcome) => {
    byOriginal.set(outcome.entry.original, outcome)
    onOutcome?.(outcome)
  }

  const startedAt = Date.now()

  await batchResolve(
    domain,
    accessToken,
    entries.map((e) => e.name),
    (name, file) => {
      // 同一个文件名可能出现在多个路径下，逐个条目都报一遍
      for (const entry of entries) {
        if (entry.name !== name) continue
        if (byOriginal.has(entry.original)) continue
        report({ entry, file })
      }
    }
  )

  console.log(
    `[shopify] 批量阶段结束：${byOriginal.size}/${entries.length} 已解析，` +
      `耗时 ${Date.now() - startedAt}ms`
  )

  // 批量两轮都没捞到的，才走 REST + CDN 兜底
  const remaining = entries.filter((e) => !byOriginal.has(e.original))
  if (remaining.length > 0) {
    console.log(
      `[shopify] ${remaining.length} 项要进 REST + CDN 兜底（慢路径，` +
        `这一段的耗时通常会决定总耗时）`
    )
  }

  await mapWithConcurrency(
    remaining,
    BATCH_CONCURRENCY,
    async (entry): Promise<void> => {
      const result = await resolveShopifyFileUrl(
        domain,
        accessToken,
        entry.filePath,
        { skipGraphQL: true }
      )

      report({
        entry,
        file: result.url
          ? { url: result.url, filename: result.filename }
          : null,
        error: result.url ? undefined : result.errors[0],
      })
    }
  )

  return entries.map(
    (entry) =>
      byOriginal.get(entry.original) ?? {
        entry,
        file: null,
        error: "解析未返回结果",
      }
  )
}
