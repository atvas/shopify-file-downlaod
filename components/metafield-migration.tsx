"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { MigrateDialog, type MigratePhase } from "@/components/migrate-dialogs"
import { readListCache, writeListCache } from "@/lib/list-cache"
import type { MetafieldDefinition, MetafieldMigrateResult } from "@/lib/types"

/** 一次「加载」拉回的全量数据（缓存按源店铺整包存取） */
interface MetafieldList {
  definitions: MetafieldDefinition[]
}

interface MetafieldMigrationProps {
  storeDomain: string
  accessToken: string
  targetDomain: string
  targetToken: string
  onError: (msg: string) => void
}

/** 分组 + 条目的唯一标识 */
function defKey(def: MetafieldDefinition): string {
  return `${def.ownerType}:${def.namespace}.${def.key}`
}

export function MetafieldMigration({
  storeDomain,
  accessToken,
  targetDomain,
  targetToken,
  onError,
}: MetafieldMigrationProps) {
  const [definitions, setDefinitions] = useState<MetafieldDefinition[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** 目标站点已有哪些定义（ownerType:namespace.key）；null = 未检查/未配置 */
  const [targetDefs, setTargetDefs] = useState<Set<string> | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [phase, setPhase] = useState<MigratePhase>("confirm")
  const [progress, setProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [results, setResults] = useState<MetafieldMigrateResult[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const migrating = phase === "running"

  const isConfigured = !!storeDomain && !!accessToken
  const isTargetConfigured = !!targetDomain && !!targetToken

  // 产品 / 变体两组；条目倒序（与元对象列表一致）
  const groups = useMemo(() => {
    const reversed = [...definitions].reverse()
    return [
      {
        ownerType: "PRODUCT" as const,
        name: "产品元字段",
        items: reversed.filter((d) => d.ownerType === "PRODUCT"),
      },
      {
        ownerType: "VARIANT" as const,
        name: "变体元字段",
        items: reversed.filter((d) => d.ownerType === "VARIANT"),
      },
    ].filter((g) => g.items.length > 0)
  }, [definitions])

  // ── 目标站点已有定义（条目标识用） ─────────────────────────────────
  const targetCheckSeq = useRef(0)

  const refreshTargetDefs = useCallback(() => {
    if (!isTargetConfigured) return
    const seq = ++targetCheckSeq.current
    fetch("/api/shopify-metafields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "target-definitions",
        targetDomain,
        targetToken,
      }),
    })
      .then((res) =>
        res
          .json()
          .then(
            (data: {
              items?: { ownerType: string; namespace: string; key: string }[]
              error?: string
            }) => {
              if (!res.ok) throw new Error(data.error || "读取目标站点定义失败")
              return data
            }
          )
      )
      .then((data) => {
        if (seq !== targetCheckSeq.current) return
        setTargetDefs(
          new Set(
            (data.items ?? []).map(
              (i) => `${i.ownerType}:${i.namespace}.${i.key}`
            )
          )
        )
      })
      .catch((err) => {
        if (seq !== targetCheckSeq.current) return
        setTargetDefs(null)
        onError(err instanceof Error ? err.message : "读取目标站点定义失败")
      })
  }, [isTargetConfigured, targetDomain, targetToken, onError])

  // 列表加载后 / 目标配置变化后检查一次
  useEffect(() => {
    if (!loaded) return
    refreshTargetDefs()
  }, [loaded, refreshTargetDefs])

  // ── 加载列表 ───────────────────────────────────────────────────────
  // 缓存按源店铺区分：同一源店铺再次进入先展示缓存，再静默刷新
  const listCacheKey = `metafields:${storeDomain}`

  const applyList = useCallback((list: MetafieldList) => {
    setDefinitions(list.definitions)
    setSelected(new Set())
    setCollapsed(new Set(["PRODUCT", "VARIANT"]))
    setLoaded(true)
  }, [])

  const fetchList = useCallback(async (): Promise<MetafieldList> => {
    const res = await fetch("/api/shopify-metafields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "list",
        storeDomain,
        accessToken,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "获取元字段列表失败")
    const list: MetafieldList = { definitions: data.definitions ?? [] }
    writeListCache(listCacheKey, list)
    return list
  }, [storeDomain, accessToken, listCacheKey])

  const handleLoad = useCallback(async () => {
    if (!isConfigured || loading) return
    setLoading(true)
    setLoaded(false)
    setResults([])
    setProgress(null)
    onError("")
    try {
      applyList(await fetchList())
    } catch (err) {
      onError(err instanceof Error ? err.message : "获取元字段列表失败")
    } finally {
      setLoading(false)
    }
  }, [isConfigured, loading, fetchList, applyList, onError])

  // 静默刷新：不打骨架、不打断浏览；失败保留缓存并提示
  const refreshSilently = useCallback(async () => {
    try {
      applyList(await fetchList())
    } catch (err) {
      onError(
        `${err instanceof Error ? err.message : "获取元字段列表失败"}（仍显示缓存数据）`
      )
    }
  }, [fetchList, applyList, onError])

  // 进入页面自动加载一次（已配置源店铺时）；手动「重新加载」不受影响
  const autoLoadRef = useRef(false)
  useEffect(() => {
    if (autoLoadRef.current || !isConfigured) return
    autoLoadRef.current = true
    const cached = readListCache<MetafieldList>(listCacheKey)
    // 微任务里应用缓存/发起加载：effect 内同步 setState 会触发 lint
    // set-state-in-effect；微任务在绘制前执行，缓存展示无额外闪烁
    void Promise.resolve().then(() => {
      if (cached) {
        applyList(cached)
        return refreshSilently()
      }
      return handleLoad()
    })
  }, [isConfigured, listCacheKey, handleLoad, refreshSilently, applyList])

  // ── 勾选 ───────────────────────────────────────────────────────────
  const toggleOne = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 组头勾选：整组全选/取消
  const toggleGroup = useCallback(
    (items: MetafieldDefinition[], select: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const item of items) {
          if (select) next.add(defKey(item))
          else next.delete(defKey(item))
        }
        return next
      })
    },
    []
  )

  // 组头折叠/展开
  const toggleGroupCollapse = useCallback((type: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  // ── 迁移 ───────────────────────────────────────────────────────────
  const handleMigrate = useCallback(async () => {
    if (!isTargetConfigured) {
      onError("请先在店铺配置中设置当前目标店铺")
      return
    }
    const chosen = definitions.filter((d) => selected.has(defKey(d)))
    if (chosen.length === 0 || migrating) return

    const ac = new AbortController()
    abortRef.current = ac

    setPhase("running")
    setResults([])
    setProgress({ current: 0, total: chosen.length })
    onError("")

    try {
      const res = await fetch("/api/shopify-metafields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "migrate",
          sourceDomain: storeDomain,
          sourceToken: accessToken,
          targetDomain,
          targetToken,
          definitions: chosen,
        }),
        signal: ac.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "迁移失败")
      }
      if (!res.body) throw new Error("迁移失败")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let count = 0

      const collect = (items: MetafieldMigrateResult[]) => {
        if (items.length === 0) return
        count += items.length
        setResults((prev) => [...prev, ...items])
        setProgress({ current: count, total: chosen.length })
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        collect(
          lines
            .map((line) => line.trim())
            .filter(Boolean)
            .flatMap((line) => {
              try {
                return [JSON.parse(line) as MetafieldMigrateResult]
              } catch {
                return []
              }
            })
        )
      }

      const tail = buffer.trim()
      if (tail) {
        try {
          collect([JSON.parse(tail) as MetafieldMigrateResult])
        } catch {
          // ignore
        }
      }
      setPhase("done")
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      onError(err instanceof Error ? err.message : "迁移失败")
      setPhase("confirm")
    } finally {
      // 迁移会自动补建缺失的定义，刷新目标站点标识
      refreshTargetDefs()
    }
  }, [
    isTargetConfigured,
    definitions,
    selected,
    migrating,
    storeDomain,
    accessToken,
    targetDomain,
    targetToken,
    refreshTargetDefs,
    onError,
  ])

  // 进行中取消：中断请求并回到确认页（与推送图片弹窗一致）
  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    setPhase("confirm")
    setProgress(null)
  }, [])

  // 弹窗关闭：进行中先中断请求
  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open && phase === "running") {
        abortRef.current?.abort()
      }
      setDialogOpen(open)
    },
    [phase]
  )

  const selectedCount = selected.size

  // 确认弹窗里的待迁移清单
  const confirmItems = useMemo(
    () =>
      definitions
        .filter((d) => selected.has(defKey(d)))
        .map((d) => d.name || `${d.namespace}.${d.key}`),
    [definitions, selected]
  )

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="space-y-5 px-6 py-5">
        {/* 顶栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-sm font-semibold">产品元字段迁移</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              列出源站点产品 /
              变体元字段定义，勾选后在目标站点创建对应定义（只迁结构，不迁数据）
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-lg text-xs"
              onClick={handleLoad}
              disabled={!isConfigured || loading || migrating}
            >
              {loading ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
              ) : null}
              {loading ? "加载中" : loaded ? "重新加载" : "加载元字段"}
            </Button>
            {loaded && definitions.length > 0 && (
              <Button
                size="sm"
                className="h-7 gap-1.5 rounded-lg text-xs"
                onClick={() => {
                  setPhase("confirm")
                  setDialogOpen(true)
                }}
                disabled={
                  selectedCount === 0 || migrating || !isTargetConfigured
                }
              >
                {migrating ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                ) : (
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 17V3" />
                    <path d="m6 11 6-6 6 6" />
                    <path d="M19 21H5" />
                  </svg>
                )}
                {migrating ? "迁移中" : "迁移定义"}
                {!migrating && selectedCount > 0 && (
                  <span className="rounded-full bg-primary-foreground/20 px-1.5 py-px text-[10px] font-medium">
                    {selectedCount}
                  </span>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* 目标站点提示 */}
        <div>
          {isTargetConfigured ? (
            <p className="text-xs text-muted-foreground">
              缺失的元字段定义会自动创建，已存在的跳过
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              未配置目标站点 —— 请到「店铺配置」设置当前目标店铺后再迁移
            </p>
          )}
        </div>

        {/* 加载骨架 */}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-md bg-muted/50"
              />
            ))}
          </div>
        )}

        {/* 空状态 */}
        {!loading && !loaded && (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {isConfigured
                ? "进入页面会自动读取源站点的产品 / 变体元字段定义"
                : "请先到「店铺配置」添加店铺并设置当前源店铺"}
            </p>
          </div>
        )}

        {!loading && loaded && definitions.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              源站点没有自定义的产品 / 变体元字段（shopify
              命名空间的标准定义不列出）
            </p>
          </div>
        )}

        {/* 元字段列表 */}
        {!loading && definitions.length > 0 && (
          <div className="space-y-3">
            <div>
              {groups.map((group) => {
                const groupAll = group.items.every((d) =>
                  selected.has(defKey(d))
                )
                const isCollapsed = collapsed.has(group.ownerType)
                return (
                  <div key={group.ownerType}>
                    {/* 组头 —— 点击折叠/展开 */}
                    <div
                      onClick={() => toggleGroupCollapse(group.ownerType)}
                      className="flex cursor-pointer items-center gap-2.5 overflow-hidden border-b border-border/40 bg-background/95 px-2 py-4 backdrop-blur-sm transition-colors select-none hover:bg-muted/30"
                    >
                      <svg
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                          isCollapsed ? "-rotate-90" : ""
                        }`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center"
                      >
                        <Checkbox
                          checked={groupAll}
                          disabled={migrating}
                          onCheckedChange={() =>
                            toggleGroup(group.items, !groupAll)
                          }
                        />
                      </div>
                      <span className="text-small leading-none">
                        {group.name}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          {group.items.length} 条
                        </span>
                      </span>
                    </div>

                    {/* 条目 —— 相对组头缩进一级 */}
                    {!isCollapsed && (
                      <div className="ml-6 py-2 pb-2 pl-4">
                        {group.items.map((def) => {
                          const key = defKey(def)
                          const checked = selected.has(key)
                          const inTarget = targetDefs?.has(key) ?? false
                          return (
                            <div
                              key={key}
                              onClick={() => !migrating && toggleOne(key)}
                              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/40"
                            >
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center"
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={migrating}
                                  onCheckedChange={() => toggleOne(key)}
                                />
                              </div>
                              <span className="min-w-0 flex-1 truncate text-[13px] text-[#666666]">
                                {def.name || def.key}
                              </span>
                              <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground/60">
                                {def.namespace}.{def.key}
                              </span>
                              <span className="shrink-0 truncate text-[10px] text-muted-foreground/60">
                                {def.type}
                              </span>
                              {targetDefs &&
                                (inTarget ? (
                                  <span
                                    className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                                    title="目标站点已有该元字段定义"
                                  >
                                    目标已有
                                  </span>
                                ) : (
                                  <span
                                    className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400"
                                    title="目标站点暂无该定义，迁移时会自动创建"
                                  >
                                    目标缺失
                                  </span>
                                ))}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="text-[10px] leading-relaxed text-muted-foreground/60">
              只迁移元字段定义（字段结构）；产品 /
              变体上的字段值不在迁移范围内。
            </p>
          </div>
        )}

        {/* 迁移弹窗（确认 → 进度 → 完成，与推送图片弹窗同款） */}
        <MigrateDialog
          open={dialogOpen}
          onOpenChange={handleDialogOpenChange}
          phase={phase}
          title="迁移元字段定义到目标站点"
          description={`将在目标店铺 ${targetDomain} 创建勾选的 ${selectedCount} 个元字段定义（已存在的跳过）；只迁移定义结构，不迁移产品/变体上的数据。`}
          items={confirmItems}
          progress={progress}
          results={results}
          onConfirm={() => void handleMigrate()}
          onCancel={handleCancel}
        />
      </CardContent>
    </Card>
  )
}
