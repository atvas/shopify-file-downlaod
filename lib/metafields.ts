/**
 * 产品 / 变体元字段（Metafield）定义的读取与跨店铺迁移。
 *
 * 迁移 = 把源站点勾选的元字段定义复制到目标站点（**只迁定义结构，
 * 不迁移产品/变体上的字段值** —— 值涉及跨店产品对齐，明确不在范围内）。
 */

import { SHOPIFY_API_VERSION, mapWithConcurrency } from "@/lib/shopify"
import { fetchMetaobjectDefinitions } from "@/lib/metaobjects"
import type { MetafieldDefinition, MetafieldMigrateResult } from "@/lib/types"

// ── 配置 ───────────────────────────────────────────────────────────────

/** 定义每页取多少条 */
const PAGE_SIZE = 50

/** 翻页护栏：50 × 200 = 一万个定义，超过这个量级本工具也不合适 */
const MAX_PAGES = 200

/** 写并发（建定义），和元对象迁移一致压着点走 */
const WRITE_CONCURRENCY = 4

// ── GraphQL 基础 ───────────────────────────────────────────────────────
//
// 与 lib/metaobjects.ts 各留一份（错误要带回去给逐条结果展示，形状不同），
// 这边的 scope 提示是产品的读写权限。

interface GqlResult {
  ok: boolean
  data: Record<string, unknown>
  messages: string[]
}

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
            `${base} 请在 Shopify 后台为该 App 补充元字段权限范围(scope)：` +
            "read_products、write_products"
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

function userErrorMessages(userErrors: UserError[] | undefined): string {
  return (userErrors ?? [])
    .map((e) => e.message ?? "未知错误")
    .filter(Boolean)
    .join("；")
}

// ── 查询 ───────────────────────────────────────────────────────────────

// **定义上的 `type` 必须写 `type { name }`**：它是 MetafieldDefinitionType
// 对象（与 lib/metaobjects.ts 里 MetaobjectFieldDefinition.type 同一个类型
// 陷阱），光写 `type` 会让整条查询被 "Field must have selections" 拒绝。
// 创建输入要的则是拍平后的 name 字符串（normalizeDefinition）。
//
// **`metafieldDefinitions(ownerType:)` 是必填参数**，产品和变体要分两次查。
//
// **`MetafieldOwnerType` 枚举里变体是 `PRODUCTVARIANT`**，不是 `VARIANT` ——
// 传错值整个变量会被 Shopify 以 "provided invalid value" 拒绝。内部模型用
// VARIANT（UI 分组好看），出入 GraphQL 时经 WIRE_OWNER_TYPE 映射。
const WIRE_OWNER_TYPE: Record<MetafieldDefinition["ownerType"], string> = {
  PRODUCT: "PRODUCT",
  VARIANT: "PRODUCTVARIANT",
}

const DEFINITIONS_QUERY = `
  query MetafieldDefinitions($first: Int!, $after: String, $ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(first: $first, after: $after, ownerType: $ownerType) {
      nodes {
        id
        namespace
        key
        name
        description
        type { name }
        validations { name value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

/**
 * 建定义的 mutation **刻意不用 typed variable、也不取创建结果**：
 * 2024-01 里这个 mutation 的输入类型名不是 `MetafieldDefinitionCreateInput`
 * （写死会被 "isn't a defined input type" 整个拒掉），payload 的定义字段名
 * 也不是 `metafieldDefinition`。把 definition 以字面量内联（类型由 schema
 * 推导）、payload 只取 userErrors —— 两个坑一起绕开，创建结果用不到。
 */
function definitionLiteral(def: MetafieldDefinition): string {
  const fields: string[] = [
    `ownerType: ${WIRE_OWNER_TYPE[def.ownerType]}`,
    `namespace: ${JSON.stringify(def.namespace)}`,
    `key: ${JSON.stringify(def.key)}`,
    `type: ${JSON.stringify(def.type)}`,
    `name: ${JSON.stringify(def.name)}`,
  ]
  if (def.description) {
    fields.push(`description: ${JSON.stringify(def.description)}`)
  }
  if (def.validations?.length) {
    const validations = def.validations.map(
      (v) =>
        `{ name: ${JSON.stringify(v.name)}, value: ${JSON.stringify(v.value)} }`
    )
    fields.push(`validations: [${validations.join(", ")}]`)
  }
  return `{ ${fields.join(", ")} }`
}

function buildDefinitionCreateMutation(def: MetafieldDefinition): string {
  return `
  mutation {
    metafieldDefinitionCreate(definition: ${definitionLiteral(def)}) {
      userErrors { field message }
    }
  }
`
}

// ── 读取：定义 ─────────────────────────────────────────────────────────

interface WireDefinition {
  id: string
  namespace: string
  key: string
  name: string
  description?: string | null
  type: { name: string } | string
  validations?: { name: string; value: string }[] | null
}

/**
 * Shopify 保留给标准元字段的命名空间（`shopify`，如 shopify.color-pattern）。
 * 平台自带的标准定义不是商家自定义数据，列表默认排除；迁移它们也无意义。
 */
export function isSystemMetafieldDef(def: MetafieldDefinition): boolean {
  return def.namespace === "shopify"
}

/** 把 `type { name }` 拍平回类型名字符串（创建输入用字符串） */
function normalizeDefinition(
  wire: WireDefinition,
  ownerType: MetafieldDefinition["ownerType"]
): MetafieldDefinition {
  return {
    id: wire.id,
    ownerType,
    namespace: wire.namespace,
    key: wire.key,
    name: wire.name,
    description: wire.description,
    type: typeof wire.type === "string" ? wire.type : wire.type.name,
    validations: wire.validations,
  }
}

/** 拉取产品 + 变体两个 ownerType 的全部元字段定义 */
export async function fetchMetafieldDefinitions(
  domain: string,
  accessToken: string
): Promise<{ definitions: MetafieldDefinition[]; error?: string }> {
  const definitions: MetafieldDefinition[] = []

  for (const ownerType of ["PRODUCT", "VARIANT"] as const) {
    let after: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await requestGraphQL(
        domain,
        accessToken,
        DEFINITIONS_QUERY,
        { first: PAGE_SIZE, after, ownerType: WIRE_OWNER_TYPE[ownerType] }
      )
      if (!result.ok) {
        return {
          definitions,
          error: `读取元字段定义失败: ${result.messages.join("；")}`,
        }
      }

      const connection = result.data.metafieldDefinitions as
        | {
            nodes?: WireDefinition[]
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
          }
        | undefined

      for (const node of connection?.nodes ?? []) {
        definitions.push(normalizeDefinition(node, ownerType))
      }
      const pageInfo = connection?.pageInfo
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break
      after = pageInfo.endCursor
    }
  }

  return { definitions }
}

// ── 写入：定义 ─────────────────────────────────────────────────────────

async function createDefinition(
  tgt: { domain: string; token: string },
  def: MetafieldDefinition
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await requestGraphQL(
    tgt.domain,
    tgt.token,
    buildDefinitionCreateMutation(def)
  )
  if (!result.ok) return { ok: false, error: result.messages.join("；") }

  const payload = result.data.metafieldDefinitionCreate as
    { userErrors?: UserError[] } | undefined
  const error = userErrorMessages(payload?.userErrors)
  if (error) return { ok: false, error }

  return { ok: true }
}

// ── 迁移编排 ───────────────────────────────────────────────────────────

export interface MetafieldMigrateParams {
  /** 已勾选的定义 */
  definitions: MetafieldDefinition[]
  /** 源站点（仅用于把验证项里的元对象定义 GID 按身份重映射） */
  src: { domain: string; token: string }
  tgt: { domain: string; token: string }
  /** 每个定义**恰好回调一次**（含失败的）——客户端靠这个收口 spinner */
  onResult: (result: MetafieldMigrateResult) => void
}

function defKey(def: MetafieldDefinition): string {
  return `${def.ownerType}:${def.namespace}.${def.key}`
}

function defResult(
  def: MetafieldDefinition,
  status: MetafieldMigrateResult["status"],
  extra?: { error?: string; warning?: string }
): MetafieldMigrateResult {
  return {
    id: def.id,
    name: def.name || `${def.namespace}.${def.key}`,
    handle: `${def.namespace}.${def.key}`,
    type: def.ownerType,
    status,
    error: extra?.error,
    warning: extra?.warning,
  }
}

/** 只迁移定义：目标缺失的补建，已存在的跳过。每个定义恰好一行结果 */
export async function migrateMetafields(
  params: MetafieldMigrateParams
): Promise<void> {
  const { definitions, src, tgt, onResult } = params
  const report = (result: MetafieldMigrateResult) => onResult(result)

  // ── 目标站点已有定义 ─────────────────────────────────────────────
  const targetDefs = await fetchMetafieldDefinitions(tgt.domain, tgt.token)
  if (targetDefs.error) {
    const error = targetDefs.error
    for (const def of definitions) report(defResult(def, "error", { error }))
    return
  }

  const targetKeys = new Set(targetDefs.definitions.map(defKey))

  /**
   * validations 里的跨店 GID 处理（GID 跨店不通用，见 lib/metaobjects.ts）：
   * - `gid://shopify/MetaobjectDefinition/*`（metaobject_reference 等定义的
   *   metaobject_definition_id）→ 源 GID 按定义 type 找目标站点同 type 定义
   *   的 GID 重映射；目标缺少该元对象定义时报错引导先迁移
   * - 其他 `gid://` 值（没有可靠的跨店身份）→ 丢弃该验证项并给出警告
   */
  let remap: Promise<{
    srcTypeByGid: Map<string, string>
    tgtGidByType: Map<string, string>
  }> | null = null
  const getRemap = () => {
    if (!remap) {
      remap = (async () => {
        const [srcDefs, tgtDefs] = await Promise.all([
          fetchMetaobjectDefinitions(src.domain, src.token),
          fetchMetaobjectDefinitions(tgt.domain, tgt.token),
        ])
        if (srcDefs.error) {
          throw new Error(`读取源站点元对象定义失败: ${srcDefs.error}`)
        }
        if (tgtDefs.error) {
          throw new Error(`读取目标站点元对象定义失败: ${tgtDefs.error}`)
        }
        return {
          srcTypeByGid: new Map(srcDefs.definitions.map((d) => [d.id, d.type])),
          tgtGidByType: new Map(tgtDefs.definitions.map((d) => [d.type, d.id])),
        }
      })()
    }
    return remap
  }

  // ── 补建缺失定义 ─────────────────────────────────────────────────
  const createErrors = new Map<string, string>()
  const warnings = new Map<string, string[]>()
  await mapWithConcurrency(definitions, WRITE_CONCURRENCY, async (def) => {
    const key = defKey(def)
    if (targetKeys.has(key)) return

    // 重映射 / 剔除验证项里的跨店 GID
    let validations = def.validations ?? []
    const hasGid = validations.some((v) => v.value.trim().startsWith("gid://"))
    if (hasGid) {
      try {
        const { srcTypeByGid, tgtGidByType } = await getRemap()
        const dropped: string[] = []
        const mapped: { name: string; value: string }[] = []
        for (const v of validations) {
          const value = v.value.trim()
          if (!value.startsWith("gid://")) {
            mapped.push(v)
            continue
          }
          if (!value.startsWith("gid://shopify/MetaobjectDefinition/")) {
            dropped.push(v.name)
            continue
          }
          const srcType = srcTypeByGid.get(value)
          if (!srcType) {
            throw new Error(
              `验证项 ${v.name} 引用的元对象定义（${value}）不属于源站点`
            )
          }
          const tgtGid = tgtGidByType.get(srcType)
          if (!tgtGid) {
            throw new Error(
              `目标站点缺少元对象定义 ${srcType}，请先在「元对象迁移」中迁移该定义`
            )
          }
          mapped.push({ ...v, value: tgtGid })
        }
        validations = mapped
        if (dropped.length > 0) {
          warnings.set(key, [
            `验证项 ${dropped.join("、")} 的跨店引用无法对齐，已丢弃`,
          ])
        }
      } catch (err) {
        createErrors.set(
          key,
          err instanceof Error ? err.message : "引用重映射失败"
        )
        return
      }
    }

    const created = await createDefinition(tgt, { ...def, validations })
    if (!created.ok) createErrors.set(key, created.error)
  })

  // ── 逐定义收口：每个定义恰好一行 ─────────────────────────────────
  for (const def of definitions) {
    const key = defKey(def)
    const err = createErrors.get(key)
    const warning = warnings.get(key)?.join("；")
    if (err) {
      report(
        defResult(def, "error", {
          error: `创建元字段定义失败: ${err}`,
          warning,
        })
      )
    } else if (targetKeys.has(key)) {
      report(defResult(def, "skipped", { warning }))
    } else {
      report(defResult(def, "migrated", { warning }))
    }
  }
}
