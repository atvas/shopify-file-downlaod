export interface MediaFile {
  url: string
  name: string
  type: "video" | "image"
  selected: boolean
  resolvedUrl?: string | null
}

/** /api/shopify-resolve 按 NDJSON 逐行推送的条目 */
export interface ResolveResult {
  original: string
  resolved: string | null
  filename: string | null
  error?: string
}

// ── 元对象（Metaobject）────────────────────────────────────────────────

/** 元对象定义中的单个字段定义 */
export interface MetaobjectFieldDef {
  key: string
  name: string
  type: string
  required?: boolean | null
  validations?: { name: string; value: string }[] | null
}

/** 元对象定义（类型） */
export interface MetaobjectDefinition {
  id: string
  type: string
  name: string
  displayNameKey?: string | null
  fieldDefinitions: MetaobjectFieldDef[]
}

/** 元对象条目上的单个字段值 */
export interface MetaobjectField {
  key: string
  value: string | null
  type: string
}

/** 元对象条目 */
export interface MetaobjectEntry {
  id: string
  type: string
  handle: string
  displayName: string
  fields: MetaobjectField[]
}

/** /api/shopify-metaobjects 迁移时按 NDJSON 逐行推送的结果 */
export interface MetaobjectMigrateResult {
  id: string
  name: string
  handle: string
  type: string
  status: "migrated" | "skipped" | "error"
  error?: string
  warning?: string
}

/** 产品 / 变体元字段定义（元字段的“结构”） */
export interface MetafieldDefinition {
  id: string
  ownerType: "PRODUCT" | "VARIANT"
  namespace: string
  key: string
  /** 元字段类型名（single_line_text_field / list.number_integer / …） */
  type: string
  name: string
  description?: string | null
  validations?: { name: string; value: string }[] | null
}

/** /api/shopify-metafields 迁移结果，形状与元对象迁移一致 */
export type MetafieldMigrateResult = MetaobjectMigrateResult
