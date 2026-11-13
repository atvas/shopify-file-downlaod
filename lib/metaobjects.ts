/**
 * Shopify 元对象（Metaobject）的读取与跨店铺迁移逻辑。
 *
 * 迁移 = 把源站点勾选的元对象条目复制到目标站点：
 *   1. 目标站点缺少对应「元对象定义」时自动创建（含字段结构）
 *   2. 按 handle 跳过目标站点已存在的条目
 *   3. 引用字段做跨店重映射 —— **绝不把源店铺的 GID 直接写进目标店铺**：
 *      两个店铺的 GID 数值段是重叠的，`gid://shopify/Product/123` 在目标
 *      站点可能指向完全不相干的资源，错引用比缺失更糟。解析不了的引用
 *      一律留空并给出警告。
 */

import {
  SHOPIFY_API_VERSION,
  buildSearchQueries,
  mapWithConcurrency,
  nodeMatches,
  safeDecode,
  type FileNode,
} from "@/lib/shopify"
import type {
  MetaobjectDefinition,
  MetaobjectEntry,
  MetaobjectFieldDef,
  MetaobjectMigrateResult,
} from "@/lib/types"

// ── 配置 ───────────────────────────────────────────────────────────────

/** 定义 / 条目每页取多少条。列表要拉全量，页大小只影响往返次数。 */
const PAGE_SIZE = 50

/** 翻页护栏：50 × 200 = 一万条，超过这个量级本工具也不合适 */
const MAX_PAGES = 200

/**
 * 条目迁移的并发数。
 * 这是**写**操作，且每个条目还带引用解析的读请求，压着点走，
 * 不要像下载那样开到 6。
 */
const ENTRY_CONCURRENCY = 4

/**
 * 迁移轮数上限。每轮处理「上一轮因引用未就绪而等待」的条目：
 * A 必填引用 B 时，B 可能比 A 晚创建，靠后续轮次把 A 补齐。
 * 轮数要盖过常见引用链深度，最后一轮强制收尾（不再等待）。
 */
const MAX_ROUNDS = 4

// ── GraphQL 基础 ───────────────────────────────────────────────────────

interface GqlResult {
  ok: boolean
  data: Record<string, unknown>
  messages: string[]
}

/**
 * 发一个 GraphQL 请求。
 * 这里和 `lib/shopify.ts` 的 postGraphQL 是两个消费者：那边关心
 * ACCESS_DENIED 分流，这边需要把错误**文案**带回去给逐条结果展示，
 * 形状不同，故各留一份，不做强行合并。
 */
async function requestGraphQL(
  domain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<GqlResult> {
  try {
    const response = await fetch(
      `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables }),
      }
    )

    if (!response.ok) {
      return {
        ok: false,
        data: {},
        messages: [`Shopify API 请求失败 (HTTP ${response.status})`],
      }
    }

    const payload = await response.json()
    const messages: string[] = (payload.errors ?? []).map(
      (e: { message?: string; extensions?: { code?: string } }) => {
        const base = e.message ?? "未知 GraphQL 错误"
        if (e.extensions?.code === "ACCESS_DENIED") {
          return (
            `${base} 请在 Shopify 后台为该 App 补充元对象权限范围(scope)：` +
            "read/write_metaobjects、read/write_metaobject_definitions"
          )
        }
        return base
      }
    )
    return { ok: messages.length === 0, data: payload.data ?? {}, messages }
  } catch (err) {
    return {
      ok: false,
      data: {},
      messages: [err instanceof Error ? err.message : "请求失败"],
    }
  }
}

interface UserError {
  field?: string[] | null
  message?: string | null
}

/** 把 userErrors 转成一行错误文案 */
function userErrorMessages(userErrors: UserError[] | undefined): string {
  return (userErrors ?? [])
    .map((e) => e.message ?? "未知错误")
    .filter(Boolean)
    .join("；")
}

// ── 查询 ───────────────────────────────────────────────────────────────

// displayNameKey 是定义上「用哪个字段做显示名」的配置（2023-10 起提供），
// 不迁移的话目标站点的条目显示名会退回默认字段。
//
// **fieldDefinitions 的 type 必须写 `type { name }`**：它的类型是
// MetafieldDefinitionType 对象（含 name/category），不是字符串 —— 光写 `type`
// 会让整条查询被 "Field must have selections" 拒绝。注意条目上的
// `MetaobjectField.type` 恰恰是 String，别顺手把 ENTRIES_QUERY 也改了。
// 创建定义的输入 `MetaobjectFieldDefinitionCreateInput.type` 要的是 name
// 字符串，读回来后在 normalizeDefinition 里拍平。
const DEFINITIONS_QUERY = `
  query MetaobjectDefinitions($first: Int!, $after: String) {
    metaobjectDefinitions(first: $first, after: $after) {
      nodes {
        id
        type
        name
        displayNameKey
        fieldDefinitions {
          key
          name
          type { name }
          required
          validations { name value }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

// **2024-01 里 `metaobjects(type:)` 是必填参数**（String!），没有「全部类型」
// 的查询方式 —— 列全量条目只能拿着定义列表逐类型枚举（见
// fetchAllMetaobjectEntries）。别把 type 声明成可空再传 null，校验都过不了。
const ENTRIES_QUERY = `
  query Metaobjects($first: Int!, $after: String, $type: String!) {
    metaobjects(first: $first, after: $after, type: $type) {
      nodes {
        id
        type
        handle
        displayName
        fields { key value type }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

/** 只要 id + handle：判断目标站点是否已有同名条目用 */
const HANDLES_QUERY = `
  query MetaobjectHandles($first: Int!, $after: String, $type: String!) {
    metaobjects(first: $first, after: $after, type: $type) {
      nodes { id handle }
      pageInfo { hasNextPage endCursor }
    }
  }
`

const DEFINITION_CREATE_MUTATION = `
  mutation MetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message }
    }
  }
`

const METAOBJECT_CREATE_MUTATION = `
  mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message }
    }
  }
`

const METAOBJECT_UPDATE_MUTATION = `
  mutation MetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject { id }
      userErrors { field message }
    }
  }
`

/**
 * 引用字段解析：拿到源 GID 对应的「身份」（元对象的 type+handle，
 * 文件的文件名），再到目标站点按身份找对应资源。
 * inline fragment 的字段在响应里是平铺的，别按嵌套结构读。
 */
const REF_NODE_QUERY = `
  query RefNode($id: ID!) {
    node(id: $id) {
      ... on Metaobject { type handle }
      ... on MediaImage { alt image { url } }
      ... on Video { filename alt }
      ... on GenericFile { alt url }
    }
  }
`

/** 目标站点按文件名找文件，拿 GID。filename/status 只能放在 ... on Video 里 */
const FILE_SEARCH_QUERY = `
  query FindFile($query: String!, $first: Int!) {
    files(first: $first, query: $query) {
      nodes {
        id
        alt
        ... on MediaImage { image { url } }
        ... on Video { filename status originalSource { url } sources { url } }
        ... on GenericFile { url }
      }
    }
  }
`

// ── 读取：定义与条目 ───────────────────────────────────────────────────

/** GraphQL 返回的字段定义：type 是 `type { name }` 对象 */
interface WireFieldDef extends Omit<MetaobjectFieldDef, "type"> {
  type: { name: string } | string
}

interface WireDefinition extends Omit<
  MetaobjectDefinition,
  "fieldDefinitions"
> {
  fieldDefinitions: WireFieldDef[]
}

/** 把 `type { name }` 拍平回类型名字符串（创建输入与类型判断都用字符串） */
function normalizeDefinition(wire: WireDefinition): MetaobjectDefinition {
  return {
    ...wire,
    fieldDefinitions: wire.fieldDefinitions.map((field) => ({
      ...field,
      type: typeof field.type === "string" ? field.type : field.type.name,
    })),
  }
}

/**
 * Shopify 保留给系统/标准元对象的类型前缀（`shopify--`，如
 * shopify--color-pattern）。这些是平台自带的分类定义，不是商家自定义
 * 数据，列表默认排除；且保留类型名不允许在目标站点创建，迁移无意义。
 */
export function isSystemMetaobjectType(type: string): boolean {
  return type.startsWith("shopify--")
}

export async function fetchMetaobjectDefinitions(
  domain: string,
  accessToken: string
): Promise<{ definitions: MetaobjectDefinition[]; error?: string }> {
  const definitions: MetaobjectDefinition[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await requestGraphQL(
      domain,
      accessToken,
      DEFINITIONS_QUERY,
      {
        first: PAGE_SIZE,
        after,
      }
    )
    if (!result.ok) {
      return {
        definitions,
        error: `读取元对象定义失败: ${result.messages.join("；")}`,
      }
    }

    const connection = result.data.metaobjectDefinitions as
      | {
          nodes?: WireDefinition[]
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
        }
      | undefined

    definitions.push(...(connection?.nodes ?? []).map(normalizeDefinition))
    const pageInfo = connection?.pageInfo
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
    after = pageInfo.endCursor
  }

  return { definitions }
}

/** 拉取某个类型的全部条目（`metaobjects(type:)` 在 2024-01 是必填参数） */
async function fetchEntriesByType(
  domain: string,
  accessToken: string,
  type: string
): Promise<{ entries: MetaobjectEntry[]; error?: string }> {
  const entries: MetaobjectEntry[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await requestGraphQL(domain, accessToken, ENTRIES_QUERY, {
      first: PAGE_SIZE,
      after,
      type,
    })
    if (!result.ok) {
      return {
        entries,
        error: `读取元对象条目失败: ${result.messages.join("；")}`,
      }
    }

    const connection = result.data.metaobjects as
      | {
          nodes?: MetaobjectEntry[]
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
        }
      | undefined

    entries.push(...(connection?.nodes ?? []))
    const pageInfo = connection?.pageInfo
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
    after = pageInfo.endCursor
  }

  return { entries }
}

/**
 * 拉取一批类型的全部条目。
 * 逐类型并发（不是串行 for，也不是 Promise.all）—— 一个店铺几十个类型时
 * 串行会把列表加载拖得很长。
 */
export async function fetchAllMetaobjectEntries(
  domain: string,
  accessToken: string,
  types: string[]
): Promise<{ entries: MetaobjectEntry[]; error?: string }> {
  const results = await mapWithConcurrency(types, ENTRY_CONCURRENCY, (type) =>
    fetchEntriesByType(domain, accessToken, type)
  )

  const entries: MetaobjectEntry[] = []
  const errors: string[] = []
  for (const result of results) {
    entries.push(...result.entries)
    if (result.error) errors.push(result.error)
  }

  if (errors.length > 0) {
    return { entries, error: [...new Set(errors)].join("；") }
  }
  return { entries }
}

/** 目标站点某个类型下 handle → GID 的映射。每个类型只拉一次 */
async function fetchTypeHandleMap(
  domain: string,
  accessToken: string,
  type: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let after: string | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await requestGraphQL(domain, accessToken, HANDLES_QUERY, {
      first: PAGE_SIZE,
      after,
      type,
    })
    if (!result.ok) break

    const connection = result.data.metaobjects as
      | {
          nodes?: { id: string; handle: string }[]
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
        }
      | undefined

    for (const node of connection?.nodes ?? []) {
      map.set(node.handle, node.id)
    }
    const pageInfo = connection?.pageInfo
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
    after = pageInfo.endCursor
  }

  return map
}

// ── 引用解析 ───────────────────────────────────────────────────────────

interface SrcRefInfo {
  /** 元对象引用的身份 */
  metaobject?: { type: string; handle: string }
  /** 文件引用的候选文件名 */
  fileName?: string
}

interface FieldInput {
  key: string
  value: string
}

/** list.xxx 引用字段的值是 JSON 数组字符串，单值字段就是 GID 本身 */
function parseGidList(value: string | null, isList: boolean): string[] {
  if (!value) return []
  if (!isList) return [value]
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === "string")
    }
  } catch {
    // 非法 JSON 当作解析不了处理
  }
  return []
}

function encodeRefValue(gids: string[], isList: boolean): string {
  return isList ? JSON.stringify(gids) : gids[0]
}

/** 引用字段的基础类型（去掉 list. 前缀） */
function baseFieldType(type: string): string {
  return type.startsWith("list.") ? type.slice(5) : type
}

function isReferenceField(type: string): boolean {
  return baseFieldType(type).endsWith("_reference")
}

/** 从文件节点推出一个可用于目标站点搜索的名字 */
function fileNameFromNode(node: SrcRefInfo): string | undefined {
  return node.fileName
}

function deriveFileName(fields: {
  filename?: string | null
  alt?: string | null
  image?: { url?: string | null } | null
  url?: string | null
}): string | undefined {
  const direct = (fields.filename ?? "").trim() || (fields.alt ?? "").trim()
  if (direct) return direct

  // 图片 / 通用文件退到 URL 末段。CDN 会把空格转义成 %20，
  // 不解码的话带空格的名字永远搜不到（和 nodeMatches 同一个坑）。
  const url = fields.image?.url ?? fields.url ?? ""
  const last = url.split("?")[0].split("/").pop()
  if (!last) return undefined
  return safeDecode(last)
}

interface RefResolver {
  /** 源 GID → 源节点身份，缓存 */
  srcNodeCache: Map<string, SrcRefInfo | null>
  /**
   * 目标站点 handle → GID，按类型缓存。
   * 缓存的是 Promise：并发 worker 同时要同一类型时共享同一次请求，
   * 否则后写入的 Map 会覆盖先写入的，刚创建的条目记录会丢。
   */
  targetHandleMaps: Map<string, Promise<Map<string, string>>>
  /** 目标站点文件名 → 文件 GID，缓存（含未命中） */
  targetFileIds: Map<string, string | null>
  /** 本次迁移已创建的条目：源 GID → 目标 GID */
  created: Map<string, string>
  src: { domain: string; token: string }
  tgt: { domain: string; token: string }
}

/** 取目标站点某类型的 handle → GID 映射（同类型并发共享一次请求） */
async function getTypeHandleMap(
  resolver: RefResolver,
  type: string
): Promise<Map<string, string>> {
  let pending = resolver.targetHandleMaps.get(type)
  if (!pending) {
    pending = fetchTypeHandleMap(resolver.tgt.domain, resolver.tgt.token, type)
    resolver.targetHandleMaps.set(type, pending)
  }
  return pending
}

async function fetchSrcRefInfo(
  resolver: RefResolver,
  gid: string
): Promise<SrcRefInfo | null> {
  const cached = resolver.srcNodeCache.get(gid)
  if (cached !== undefined) return cached

  const result = await requestGraphQL(
    resolver.src.domain,
    resolver.src.token,
    REF_NODE_QUERY,
    { id: gid }
  )

  let info: SrcRefInfo | null = null
  if (result.ok) {
    const node = (result.data.node ?? null) as {
      type?: string | null
      handle?: string | null
      filename?: string | null
      alt?: string | null
      image?: { url?: string | null } | null
      url?: string | null
    } | null

    if (node?.type && node.handle) {
      info = { metaobject: { type: node.type, handle: node.handle } }
    } else if (node) {
      const fileName = deriveFileName(node)
      if (fileName) info = { fileName }
    }
  }

  resolver.srcNodeCache.set(gid, info)
  return info
}

/**
 * 目标站点按文件名找文件 GID。
 * 精确匹配（复用 nodeMatches 的比对规则，含解码与视频 filename 陷阱），
 * 不做 includes 模糊认领 —— 模糊匹配会把 A 的文件认给 B。
 */
async function findTargetFileId(
  resolver: RefResolver,
  fileName: string
): Promise<string | null> {
  const cached = resolver.targetFileIds.get(fileName)
  if (cached !== undefined) return cached

  let found: string | null = null
  for (const searchQuery of buildSearchQueries(fileName)) {
    const result = await requestGraphQL(
      resolver.tgt.domain,
      resolver.tgt.token,
      FILE_SEARCH_QUERY,
      {
        query: searchQuery,
        first: 5,
      }
    )
    if (!result.ok) continue

    const connection = result.data.files as
      { nodes?: ({ id: string } & FileNode)[] } | undefined

    for (const node of connection?.nodes ?? []) {
      if (nodeMatches(node, fileName)) {
        found = node.id
        break
      }
    }
    if (found) break
  }

  resolver.targetFileIds.set(fileName, found)
  return found
}

/** 元对象引用：源 GID → 目标 GID。本批已创建的优先，否则按 type+handle 找 */
async function resolveMetaobjectRef(
  resolver: RefResolver,
  srcGid: string
): Promise<string | null> {
  const created = resolver.created.get(srcGid)
  if (created) return created

  const info = await fetchSrcRefInfo(resolver, srcGid)
  if (!info?.metaobject) return null

  const { type, handle } = info.metaobject
  const map = await getTypeHandleMap(resolver, type)
  return map.get(handle) ?? null
}

/** 文件引用：源 GID → 目标文件 GID，按文件名对齐 */
async function resolveFileRef(
  resolver: RefResolver,
  srcGid: string
): Promise<string | null> {
  const info = await fetchSrcRefInfo(resolver, srcGid)
  const name = info ? fileNameFromNode(info) : undefined
  if (!name) return null
  return findTargetFileId(resolver, name)
}

async function resolveRefValue(
  resolver: RefResolver,
  fieldType: string,
  srcGid: string
): Promise<string | null> {
  return baseFieldType(fieldType) === "file_reference"
    ? resolveFileRef(resolver, srcGid)
    : resolveMetaobjectRef(resolver, srcGid)
}

// ── 写入：定义与条目 ───────────────────────────────────────────────────

async function createDefinition(
  domain: string,
  accessToken: string,
  sourceDef: MetaobjectDefinition
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fieldDefinitions = sourceDef.fieldDefinitions.map(
    (field: MetaobjectFieldDef) => ({
      key: field.key,
      name: field.name,
      type: field.type,
      required: field.required ?? undefined,
      validations: field.validations?.length ? field.validations : undefined,
    })
  )

  const result = await requestGraphQL(
    domain,
    accessToken,
    DEFINITION_CREATE_MUTATION,
    {
      definition: {
        name: sourceDef.name,
        type: sourceDef.type,
        displayNameKey: sourceDef.displayNameKey || undefined,
        fieldDefinitions,
      },
    }
  )
  if (!result.ok) return { ok: false, error: result.messages.join("；") }

  const payload = result.data.metaobjectDefinitionCreate as
    { userErrors?: UserError[] } | undefined
  const error = userErrorMessages(payload?.userErrors)
  if (error) return { ok: false, error }

  return { ok: true }
}

async function createMetaobject(
  domain: string,
  accessToken: string,
  type: string,
  handle: string,
  fields: FieldInput[]
): Promise<{ gid?: string; error?: string }> {
  const result = await requestGraphQL(
    domain,
    accessToken,
    METAOBJECT_CREATE_MUTATION,
    { metaobject: { type, handle, fields } }
  )
  if (!result.ok) return { error: result.messages.join("；") }

  const payload = result.data.metaobjectCreate as
    | { metaobject?: { id?: string } | null; userErrors?: UserError[] }
    | undefined
  const error = userErrorMessages(payload?.userErrors)
  if (error) return { error }
  if (!payload?.metaobject?.id) return { error: "创建条目未返回 GID" }

  return { gid: payload.metaobject.id }
}

async function updateMetaobject(
  domain: string,
  accessToken: string,
  id: string,
  fields: FieldInput[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await requestGraphQL(
    domain,
    accessToken,
    METAOBJECT_UPDATE_MUTATION,
    { id, metaobject: { fields } }
  )
  if (!result.ok) return { ok: false, error: result.messages.join("；") }

  const payload = result.data.metaobjectUpdate as
    { userErrors?: UserError[] } | undefined
  const error = userErrorMessages(payload?.userErrors)
  if (error) return { ok: false, error }

  return { ok: true }
}

// ── 迁移编排 ───────────────────────────────────────────────────────────

interface PendingRefField {
  key: string
  type: string
  isList: boolean
  /** 已解析到的目标 GID（按顺序累积） */
  resolved: string[]
  /** 还没解析出目标 GID 的源 GID */
  missing: string[]
}

interface WorkItem {
  entry: MetaobjectEntry
  /** 已在目标站点创建后的 GID */
  createdGid: string | null
  /** 首轮分类结果（只算一次，避免重试时重复堆警告） */
  prepared: {
    scalarInputs: FieldInput[]
    pendingRefs: PendingRefField[]
    warnings: string[]
  } | null
  lastError: string
  warnings: string[]
}

const PROGRESS = "progress" as const
type Outcome = MetaobjectMigrateResult | typeof PROGRESS

export interface MigrateParams {
  definitions: MetaobjectDefinition[]
  entries: MetaobjectEntry[]
  /** 只把缺失的元对象定义建到目标站点，不迁移任何条目数据 */
  definitionsOnly?: boolean
  src: { domain: string; token: string }
  tgt: { domain: string; token: string }
  /** 每个条目/定义**恰好回调一次**（含失败的）——客户端靠这个收口 spinner */
  onResult: (result: MetaobjectMigrateResult) => void
}

/**
 * 只迁移定义时的结果行。定义没有 handle，身份就是 type，
 * 填在 handle 位上，客户端结果列表与条目共用同一形状。
 */
function definitionResult(
  def: MetaobjectDefinition,
  status: MetaobjectMigrateResult["status"],
  error?: string
): MetaobjectMigrateResult {
  return {
    id: def.id,
    name: def.name,
    handle: def.type,
    type: def.type,
    status,
    error,
  }
}

function resultOf(
  item: WorkItem,
  status: MetaobjectMigrateResult["status"],
  extra?: { error?: string; warning?: string }
): MetaobjectMigrateResult {
  const warning = extra?.warning ?? item.warnings.join("；")
  return {
    id: item.entry.id,
    name: item.entry.displayName || item.entry.handle,
    handle: item.entry.handle,
    type: item.entry.type,
    status,
    error: extra?.error,
    warning: warning || undefined,
  }
}

/**
 * 对 pendingRefs 里还没解析的源 GID 再试一轮解析。
 * 已解析的移入 resolved（跨轮累积，列表字段更新时写全量）。
 */
async function resolvePendingRefs(
  resolver: RefResolver,
  item: WorkItem
): Promise<void> {
  for (const ref of item.prepared?.pendingRefs ?? []) {
    const stillMissing: string[] = []
    for (const gid of ref.missing) {
      const targetGid = await resolveRefValue(resolver, ref.type, gid)
      if (targetGid) ref.resolved.push(targetGid)
      else stillMissing.push(gid)
    }
    ref.missing = stillMissing
  }
}

function refInputs(item: WorkItem): FieldInput[] {
  return (item.prepared?.pendingRefs ?? [])
    .filter((ref) => ref.resolved.length > 0)
    .map((ref) => ({
      key: ref.key,
      value: encodeRefValue(ref.resolved, ref.isList),
    }))
}

function pendingRefKeys(item: WorkItem): string[] {
  return (item.prepared?.pendingRefs ?? [])
    .filter((ref) => ref.missing.length > 0)
    .map((ref) => ref.key)
}

/** 首轮字段分类：标量直接用，引用排队解析，其余引用类型直接跳过 */
function prepareFields(
  entry: MetaobjectEntry,
  definition: MetaobjectDefinition
): NonNullable<WorkItem["prepared"]> {
  const defKeys = new Set(definition.fieldDefinitions.map((f) => f.key))
  const warnings: string[] = []
  const scalarInputs: FieldInput[] = []
  const pendingRefs: PendingRefField[] = []

  const dropped = entry.fields
    .filter((f) => !defKeys.has(f.key))
    .map((f) => f.key)
  if (dropped.length > 0) {
    warnings.push(`字段 ${dropped.join("、")} 不在目标定义中，已跳过`)
  }

  for (const field of entry.fields) {
    if (!defKeys.has(field.key) || !field.value) continue

    if (!isReferenceField(field.type)) {
      scalarInputs.push({ key: field.key, value: field.value })
      continue
    }

    const base = baseFieldType(field.type)
    if (base !== "metaobject_reference" && base !== "file_reference") {
      // 产品/集合/页面这类引用没有可靠的跨店对齐依据（handle 未必一致、
      // 目标站点未必有），抄源 GID 又会错引 —— 跳过并警告。
      warnings.push(
        `字段 ${field.key} 是 ${field.type} 引用，暂不支持跨店迁移，已跳过`
      )
      continue
    }

    pendingRefs.push({
      key: field.key,
      type: field.type,
      isList: field.type.startsWith("list."),
      resolved: [],
      missing: parseGidList(field.value, field.type.startsWith("list.")),
    })
  }

  return { scalarInputs, pendingRefs, warnings }
}

/** 已创建的条目：把这轮解析出来的引用补写回去 */
async function fixupRefs(
  resolver: RefResolver,
  item: WorkItem,
  final: boolean
): Promise<Outcome> {
  await resolvePendingRefs(resolver, item)

  const updates = refInputs(item)
  const unresolvedAfter = pendingRefKeys(item)

  if (updates.length > 0) {
    const updated = await updateMetaobject(
      resolver.tgt.domain,
      resolver.tgt.token,
      item.createdGid!,
      updates
    )
    if (!updated.ok) {
      item.lastError = updated.error
      // 条目本体已经建好了，更新失败下一轮再试；最终轮如实带警告收尾
      if (!final) return PROGRESS
      item.warnings.push(`引用字段写入失败: ${updated.error}`)
      return resultOf(item, "migrated")
    }
    // 写回成功后清掉这批已补齐的字段
    const updatedKeys = new Set(updates.map((u) => u.key))
    const prepared = item.prepared!
    prepared.pendingRefs = prepared.pendingRefs.filter(
      (ref) => !updatedKeys.has(ref.key) || ref.missing.length > 0
    )
  }

  // 还有引用没补齐 → 留给下一轮；最后一轮不再等待，强制收尾
  if (unresolvedAfter.length > 0 && !final) {
    return PROGRESS
  }

  if (unresolvedAfter.length > 0) {
    item.warnings.push(
      `字段 ${unresolvedAfter.join("、")} 的引用未能在目标站点解析，已留空`
    )
  }
  return resultOf(item, "migrated")
}

export async function migrateMetaobjects(params: MigrateParams): Promise<void> {
  const { definitions, entries, src, tgt, onResult, definitionsOnly } = params

  const report = (result: MetaobjectMigrateResult) => onResult(result)

  // ── 目标站点定义：缺的补建 ─────────────────────────────────────────
  const targetDefs = await fetchMetaobjectDefinitions(tgt.domain, tgt.token)
  if (targetDefs.error) {
    // 每个待处理项恰好一行 —— 只迁移定义时报到定义头上
    const error = targetDefs.error
    const stuck: MetaobjectMigrateResult[] = definitionsOnly
      ? definitions.map((def) => definitionResult(def, "error", error))
      : entries.map((entry) => ({
          id: entry.id,
          name: entry.displayName || entry.handle,
          handle: entry.handle,
          type: entry.type,
          status: "error" as const,
          error,
        }))
    for (const result of stuck) report(result)
    return
  }

  const targetDefByType = new Map(
    targetDefs.definitions.map((d) => [d.type, d])
  )

  // ── 只迁移定义：每个定义一行（已存在的跳过），不碰条目数据 ─────────
  if (definitionsOnly) {
    const outcomes = await mapWithConcurrency(
      definitions,
      ENTRY_CONCURRENCY,
      async (def): Promise<MetaobjectMigrateResult> => {
        if (targetDefByType.has(def.type)) {
          return definitionResult(def, "skipped")
        }
        const created = await createDefinition(tgt.domain, tgt.token, def)
        return created.ok
          ? definitionResult(def, "migrated")
          : definitionResult(
              def,
              "error",
              `创建元对象定义失败: ${created.error}`
            )
      }
    )
    for (const outcome of outcomes) report(outcome)
    return
  }

  const typeErrors = new Map<string, string>()

  const neededTypes = [...new Set(entries.map((e) => e.type))]
  for (const type of neededTypes) {
    if (targetDefByType.has(type)) continue
    const sourceDef = definitions.find((d) => d.type === type)
    if (!sourceDef) {
      typeErrors.set(type, "缺少该类型的定义信息，无法在目标站点创建")
      continue
    }
    const created = await createDefinition(tgt.domain, tgt.token, sourceDef)
    if (!created.ok) {
      typeErrors.set(type, `创建元对象定义失败: ${created.error}`)
      continue
    }
    targetDefByType.set(type, sourceDef)
  }

  // ── 逐条迁移 ───────────────────────────────────────────────────────
  const resolver: RefResolver = {
    srcNodeCache: new Map(),
    targetHandleMaps: new Map(),
    targetFileIds: new Map(),
    created: new Map(),
    src,
    tgt,
  }

  const items: WorkItem[] = entries.map((entry) => ({
    entry,
    createdGid: null,
    prepared: null,
    lastError: "",
    warnings: [],
  }))

  const processItem = async (
    item: WorkItem,
    final: boolean
  ): Promise<Outcome> => {
    const { entry } = item

    const typeError = typeErrors.get(entry.type)
    if (typeError) {
      return resultOf(item, "error", { error: typeError })
    }

    // 已创建的走引用补写
    if (item.createdGid) {
      return fixupRefs(resolver, item, final)
    }

    const handleMap = await getTypeHandleMap(resolver, entry.type)
    if (handleMap.has(entry.handle)) {
      return resultOf(item, "skipped")
    }

    const definition = targetDefByType.get(entry.type)
    if (!definition) {
      return resultOf(item, "error", {
        error: "目标站点缺少该类型的定义信息",
      })
    }

    if (!item.prepared) {
      item.prepared = prepareFields(entry, definition)
      item.warnings.push(...item.prepared.warnings)
    }

    await resolvePendingRefs(resolver, item)

    const fields = [...item.prepared.scalarInputs, ...refInputs(item)]
    const created = await createMetaobject(
      tgt.domain,
      tgt.token,
      entry.type,
      entry.handle,
      fields
    )

    if (created.gid) {
      resolver.created.set(entry.id, created.gid)
      handleMap.set(entry.handle, created.gid)
      item.createdGid = created.gid

      if (pendingRefKeys(item).length > 0) {
        // 引用还没齐 —— 留给后续轮次补写，先不上报
        return PROGRESS
      }
      return resultOf(item, "migrated")
    }

    item.lastError = created.error ?? "创建失败"
    // 有引用没解析出来时，创建失败可能只是必填引用未就绪 —— 下一轮重试
    if (pendingRefKeys(item).length > 0 && !final) {
      return PROGRESS
    }
    return resultOf(item, "error", { error: item.lastError })
  }

  let active = items
  for (let round = 0; round < MAX_ROUNDS && active.length > 0; round++) {
    const final = round === MAX_ROUNDS - 1
    const outcomes = await mapWithConcurrency(
      active,
      ENTRY_CONCURRENCY,
      (item) => processItem(item, final)
    )

    const next: WorkItem[] = []
    outcomes.forEach((outcome, index) => {
      if (outcome === PROGRESS) next.push(active[index])
      else report(outcome)
    })
    active = next
    if (final) break
  }

  // 兜底：理论上最后一轮已经全部上报，这里防呆
  for (const item of active) {
    report(
      resultOf(item, "error", {
        error: item.lastError || "迁移未能完成",
      })
    )
  }
}
