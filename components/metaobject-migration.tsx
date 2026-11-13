"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { MigrateDialog, type MigratePhase } from "@/components/migrate-dialogs"
import { readListCache, writeListCache } from "@/lib/list-cache"
import type {
  MetaobjectDefinition,
  MetaobjectEntry,
  MetaobjectMigrateResult,
} from "@/lib/types"

/** 一次「加载」拉回的全量数据（缓存按源店铺整包存取） */
interface MetaobjectList {
  definitions: MetaobjectDefinition[]
  entries: MetaobjectEntry[]
}

interface MetaobjectMigrationProps {
  storeDomain: string
  accessToken: string
  targetDomain: string
  targetToken: string
  onError: (msg: string) => void
}

export function MetaobjectMigration({
  storeDomain,
  accessToken,
  targetDomain,
  targetToken,
  onError,
}: MetaobjectMigrationProps) {
  const [definitions, setDefinitions] = useState<MetaobjectDefinition[]>([])
  const [entries, setEntries] = useState<MetaobjectEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** 目标站点已有哪些元对象定义类型；null = 未检查/未配置 */
  const [targetTypes, setTargetTypes] = useState<Set<string> | null>(null)
  /** 只迁移定义结构，不迁移条目数据 */
  const [definitionsOnly, setDefinitionsOnly] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [phase, setPhase] = useState<MigratePhase>("confirm")
  const [progress, setProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [results, setResults] = useState<MetaobjectMigrateResult[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const migrating = phase === "running"

  const isConfigured = !!storeDomain && !!accessToken
  const isTargetConfigured = !!targetDomain && !!targetToken

  // 按定义类型分组展示，组名用定义的显示名；数据倒序（后出现的排前面）
  const groups = useMemo(() => {
    const byType = new Map<string, MetaobjectEntry[]>()
    for (const entry of entries) {
      const list = byType.get(entry.type) ?? []
      list.push(entry)
      byType.set(entry.type, list)
    }
    return [...byType.entries()]
      .map(([type, list]) => ({
        type,
        name: definitions.find((d) => d.type === type)?.name || type,
        entries: [...list].reverse(),
      }))
      .reverse()
  }, [entries, definitions])

  // ── 目标站点已有定义（组头标识用） ─────────────────────────────────
  const targetCheckSeq = useRef(0)

  const refreshTargetTypes = useCallback(() => {
    if (!isTargetConfigured) return
    const seq = ++targetCheckSeq.current
    fetch("/api/shopify-metaobjects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "target-definitions",
        targetDomain,
        targetToken,
      }),
    })
      .then((res) =>
        res.json().then((data: { types?: string[]; error?: string }) => {
          if (!res.ok) throw new Error(data.error || "读取目标站点定义失败")
          return data
        })
      )
      .then((data) => {
        if (seq !== targetCheckSeq.current) return
        setTargetTypes(new Set(data.types ?? []))
      })
      .catch((err) => {
        if (seq !== targetCheckSeq.current) return
        setTargetTypes(null)
        onError(err instanceof Error ? err.message : "读取目标站点定义失败")
      })
  }, [isTargetConfigured, targetDomain, targetToken, onError])

  // 列表加载后 / 目标配置变化后检查一次
  useEffect(() => {
    if (!loaded) return
    refreshTargetTypes()
  }, [loaded, refreshTargetTypes])

  // ── 加载列表 ───────────────────────────────────────────────────────
  // 缓存按源店铺区分：同一源店铺再次进入先展示缓存，再静默刷新
  const listCacheKey = `metaobjects:${storeDomain}`

  const applyList = useCallback((list: MetaobjectList) => {
    setDefinitions(list.definitions)
    setEntries(list.entries)
    setSelected(new Set())
    // 默认全部折叠
    setCollapsed(new Set(list.entries.map((e) => e.type)))
    setLoaded(true)
  }, [])

  const fetchList = useCallback(async (): Promise<MetaobjectList> => {
    const res = await fetch("/api/shopify-metaobjects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "list",
        storeDomain,
        accessToken,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "获取元对象列表失败")
    const list: MetaobjectList = {
      definitions: data.definitions ?? [],
      entries: data.entries ?? [],
    }
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
      onError(err instanceof Error ? err.message : "获取元对象列表失败")
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
        `${err instanceof Error ? err.message : "获取元对象列表失败"}（仍显示缓存数据）`
      )
    }
  }, [fetchList, applyList, onError])

  // 进入页面自动加载一次（已配置源店铺时）；手动「重新加载」不受影响
  const autoLoadRef = useRef(false)
  useEffect(() => {
    if (autoLoadRef.current || !isConfigured) return
    autoLoadRef.current = true
    const cached = readListCache<MetaobjectList>(listCacheKey)
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
  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 组头勾选：整组全选/取消
  const toggleGroup = useCallback(
    (group: MetaobjectEntry[], select: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const entry of group) {
          if (select) next.add(entry.id)
          else next.delete(entry.id)
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

  // 已勾选条目所属的定义类型 —— 「只迁移定义」按类型收口
  const selectedTypes = useMemo(() => {
    const types = new Set<string>()
    for (const entry of entries) {
      if (selected.has(entry.id)) types.add(entry.type)
    }
    return types
  }, [entries, selected])

  // ── 迁移 ───────────────────────────────────────────────────────────
  const handleMigrate = useCallback(async () => {
    if (!isTargetConfigured) {
      onError("请先在店铺配置中设置当前目标店铺")
      return
    }
    // 只迁移定义同样只处理已勾选的：收口到勾选条目所属类型的定义
    const chosenDefs = definitionsOnly
      ? definitions.filter((d) => selectedTypes.has(d.type))
      : definitions
    const chosen = definitionsOnly
      ? []
      : entries.filter((e) => selected.has(e.id))
    const total = definitionsOnly ? chosenDefs.length : chosen.length
    if (total === 0 || migrating) return

    const ac = new AbortController()
    abortRef.current = ac

    setPhase("running")
    setResults([])
    setProgress({ current: 0, total })
    onError("")

    try {
      const res = await fetch("/api/shopify-metaobjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "migrate",
          sourceDomain: storeDomain,
          sourceToken: accessToken,
          targetDomain,
          targetToken,
          definitions: chosenDefs,
          entries: chosen,
          definitionsOnly,
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

      const collect = (items: MetaobjectMigrateResult[]) => {
        if (items.length === 0) return
        count += items.length
        setResults((prev) => [...prev, ...items])
        setProgress({ current: count, total })
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
                return [JSON.parse(line) as MetaobjectMigrateResult]
              } catch {
                return []
              }
            })
        )
      }

      const tail = buffer.trim()
      if (tail) {
        try {
          collect([JSON.parse(tail) as MetaobjectMigrateResult])
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
      // 迁移会自动补建缺失的定义，刷新组头的目标站点标识
      refreshTargetTypes()
    }
  }, [
    isTargetConfigured,
    entries,
    selected,
    selectedTypes,
    definitionsOnly,
    migrating,
    storeDomain,
    accessToken,
    targetDomain,
    targetToken,
    definitions,
    refreshTargetTypes,
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
  // 只迁移定义时收口到已勾选条目所属类型的定义
  const migrateCount = definitionsOnly
    ? definitions.filter((d) => selectedTypes.has(d.type)).length
    : selectedCount

  // 确认弹窗里的待迁移清单
  const confirmItems = useMemo(
    () =>
      definitionsOnly
        ? definitions
            .filter((d) => selectedTypes.has(d.type))
            .map((d) => d.name || d.type)
        : entries
            .filter((e) => selected.has(e.id))
            .map((e) => e.displayName || e.handle),
    [definitionsOnly, definitions, selectedTypes, entries, selected]
  )

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="space-y-5 px-6 py-5">
        {/* 顶栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-sm font-semibold">元对象迁移</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              列出源站点全部元对象，勾选后迁移到目标站点
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
              {loading ? "加载中" : loaded ? "重新加载" : "加载元对象"}
            </Button>
            {loaded && definitions.length > 0 && (
              <label
                className="flex cursor-pointer items-center gap-1.5 pr-0.5 text-xs text-muted-foreground select-none"
                title="只创建已勾选条目所属类型的元对象定义，不迁移任何条目数据"
              >
                <Checkbox
                  checked={definitionsOnly}
                  disabled={migrating}
                  onCheckedChange={(checked) =>
                    setDefinitionsOnly(checked === true)
                  }
                />
                只迁移定义
              </label>
            )}
            {loaded && definitions.length > 0 && (
              <Button
                size="sm"
                className="h-7 gap-1.5 rounded-lg text-xs"
                onClick={() => {
                  setPhase("confirm")
                  setDialogOpen(true)
                }}
                disabled={
                  migrateCount === 0 || migrating || !isTargetConfigured
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
                {migrating
                  ? "迁移中"
                  : definitionsOnly
                    ? "迁移定义"
                    : "迁移所选"}
                {!migrating && migrateCount > 0 && (
                  <span className="rounded-full bg-primary-foreground/20 px-1.5 py-px text-[10px] font-medium">
                    {migrateCount}
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
              缺失的元对象定义会自动创建，同 handle 的条目自动跳过
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
            {Array.from({ length: 3 }).map((_, i) => (
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
                ? "点击「加载元对象」读取源站点的全部元对象定义与条目"
                : "请先到「店铺配置」添加店铺并设置当前源店铺"}
            </p>
          </div>
        )}

        {!loading && loaded && entries.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {definitions.length > 0
                ? "源站点有元对象定义但没有条目数据 ——「只迁移定义」也按勾选收口，没有条目时无法选择"
                : "源站点没有元对象（或 API Token 缺少 read_metaobjects 权限）"}
            </p>
          </div>
        )}

        {/* 元对象列表 */}
        {!loading && entries.length > 0 && (
          <div className="space-y-3">
            <div>
              {groups.map((group) => {
                const groupAll = group.entries.every((e) => selected.has(e.id))
                const isCollapsed = collapsed.has(group.type)
                return (
                  <div key={group.type}>
                    {/* 组头 —— 点击折叠/展开 */}
                    <div
                      onClick={() => toggleGroupCollapse(group.type)}
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
                            toggleGroup(group.entries, !groupAll)
                          }
                        />
                      </div>
                      <span className="text-small leading-none">
                        {group.name}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground/60">
                        {group.type}
                      </span>
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        {isTargetConfigured &&
                          targetTypes &&
                          (targetTypes.has(group.type) ? (
                            <span
                              className="rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                              title="目标站点已有该元对象定义"
                            >
                              目标已有
                            </span>
                          ) : (
                            <span
                              className="rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400"
                              title="目标站点暂无该定义，迁移时会自动创建"
                            >
                              目标缺失
                            </span>
                          ))}
                        <span className="text-[11px] text-muted-foreground">
                          {group.entries.length} 条
                        </span>
                      </span>
                    </div>

                    {/* 条目 —— 相对组头缩进一级 */}
                    {!isCollapsed && (
                      <div className="ml-6 py-2 pb-2 pl-4">
                        {group.entries.map((entry) => {
                          const checked = selected.has(entry.id)
                          return (
                            <div
                              key={entry.id}
                              onClick={() => !migrating && toggleOne(entry.id)}
                              className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/40`}
                            >
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center"
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={migrating}
                                  onCheckedChange={() => toggleOne(entry.id)}
                                />
                              </div>
                              <span className="min-w-0 flex-1 truncate text-[13px] text-[#666666]">
                                {entry.displayName || entry.handle}
                              </span>
                              <span className="shrink-0 truncate text-[10px] text-muted-foreground/60">
                                {entry.handle}
                              </span>
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
              引用字段：元对象引用按
              type+handle、文件引用按文件名在目标站点重新对齐；产品等其他跨店引用暂不迁移，会跳过并在结果中提示。
            </p>
          </div>
        )}

        {/* 迁移弹窗（确认 → 进度 → 完成，与推送图片弹窗同款） */}
        <MigrateDialog
          open={dialogOpen}
          onOpenChange={handleDialogOpenChange}
          phase={phase}
          title={
            definitionsOnly
              ? "迁移元对象定义到目标站点"
              : "迁移元对象到目标站点"
          }
          description={
            definitionsOnly
              ? `将把勾选的 ${migrateCount} 个元对象定义创建到目标店铺 ${targetDomain}（已存在的跳过），不迁移条目数据。`
              : `将把勾选的 ${selectedCount} 个元对象条目迁移到目标店铺 ${targetDomain}。同 handle 的条目会自动跳过，缺失的定义会自动创建。`
          }
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
