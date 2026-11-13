"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { IconChevronDown } from "@/components/icons"
import {
  type StoreConfig,
  getStores,
  saveStores,
  getCurrentSourceId,
  getCurrentTargetId,
  setCurrentSourceId,
  setCurrentTargetId,
} from "@/lib/stores"

interface StoreConfigPanelProps {
  onError: (msg: string) => void
  /** 店铺列表 / 当前指针变化后回调（供外层刷新「已连接」之类的展示） */
  onChange?: () => void
}

/** token 只露前缀，列表里永远不整串显示 */
function maskToken(token: string): string {
  return `${token.slice(0, 7)}••••••`
}

/** 展开中的「新店铺」草稿行 */
const NEW_ID = "__new__"

export function StoreConfigPanel({ onError, onChange }: StoreConfigPanelProps) {
  const [stores, setStores] = useState<StoreConfig[]>(() => getStores())
  const [sourceId, setSourceId] = useState<string>(
    () => getCurrentSourceId() ?? ""
  )
  const [targetId, setTargetId] = useState<string>(() => {
    const target = getCurrentTargetId() ?? ""
    // 旧数据可能把同一家店铺同时设为源和目标 —— 不能兼任，撞车时清掉目标
    if (target && target === (getCurrentSourceId() ?? "")) {
      setCurrentTargetId(null)
      return ""
    }
    return target
  })

  // 折叠列表：同时只展开一行；__new__ = 末尾的新店铺草稿行
  const [openId, setOpenId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [draftDomain, setDraftDomain] = useState("")
  const [draftToken, setDraftToken] = useState("")

  const persist = useCallback(
    (next: StoreConfig[]) => {
      saveStores(next)
      setStores(next)
      onChange?.()
    },
    [onChange]
  )

  // ── 折叠 / 展开 ─────────────────────────────────────────────────────
  const openStore = useCallback(
    (store: StoreConfig) => {
      setOpenId(store.id)
      setDraftName(store.name)
      setDraftDomain(store.domain)
      setDraftToken(store.token)
      onError("")
    },
    [onError]
  )

  const toggleRow = useCallback(
    (store: StoreConfig) => {
      if (openId === store.id) setOpenId(null)
      else openStore(store)
    },
    [openId, openStore]
  )

  const startAdd = useCallback(() => {
    setOpenId(NEW_ID)
    setDraftName("")
    setDraftDomain("")
    setDraftToken("")
    onError("")
  }, [onError])

  // ── 源 / 目标勾选 ──────────────────────────────────────────────────
  // 单选语义 + 不能兼任：勾新的自动顶掉这家店原有的另一个角色，
  // 重勾已勾的 = 取消该角色。
  const toggleSource = useCallback(
    (id: string) => {
      const next = sourceId === id ? "" : id
      setSourceId(next)
      setCurrentSourceId(next || null)
      if (next && targetId === next) {
        setTargetId("")
        setCurrentTargetId(null)
      }
      onChange?.()
    },
    [sourceId, targetId, onChange]
  )

  const toggleTarget = useCallback(
    (id: string) => {
      const next = targetId === id ? "" : id
      setTargetId(next)
      setCurrentTargetId(next || null)
      if (next && sourceId === next) {
        setSourceId("")
        setCurrentSourceId(null)
      }
      onChange?.()
    },
    [sourceId, targetId, onChange]
  )

  // ── 保存 / 删除 ─────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const domain = draftDomain.trim()
    const token = draftToken.trim()
    if (!domain || !token) {
      onError("请填写店铺域名和 Admin API Token")
      return
    }
    const name = draftName.trim() || domain

    if (openId === NEW_ID) {
      const id = Date.now().toString()
      persist([...stores, { id, name, domain, token }])
      // 首家店铺自动设为当前源，业务页面开箱即用
      if (!sourceId) {
        setCurrentSourceId(id)
        setSourceId(id)
      }
    } else if (openId) {
      persist(
        stores.map((s) => (s.id === openId ? { ...s, name, domain, token } : s))
      )
    }
    setOpenId(null)
  }, [
    draftDomain,
    draftToken,
    draftName,
    openId,
    stores,
    sourceId,
    persist,
    onError,
  ])

  const handleDelete = useCallback(
    (id: string) => {
      persist(stores.filter((s) => s.id !== id))
      if (sourceId === id) {
        setCurrentSourceId(null)
        setSourceId("")
      }
      if (targetId === id) {
        setCurrentTargetId(null)
        setTargetId("")
      }
      setOpenId(null)
    },
    [stores, sourceId, targetId, persist]
  )

  // 展开行里的配置表单（编辑 / 新增共用）
  const renderForm = (isNew: boolean) => (
    <div className="space-y-4 border-t border-border/40 px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label
            htmlFor={`storeName-${openId}`}
            className="text-xs text-muted-foreground"
          >
            店铺名称
          </Label>
          <Input
            id={`storeName-${openId}`}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="可选，默认用域名"
          />
        </div>
        <div className="space-y-1.5">
          <Label
            htmlFor={`storeDomain-${openId}`}
            className="text-xs text-muted-foreground"
          >
            店铺域名
          </Label>
          <Input
            id={`storeDomain-${openId}`}
            value={draftDomain}
            onChange={(e) => setDraftDomain(e.target.value)}
            placeholder="xxx.myshopify.com"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor={`storeToken-${openId}`}
          className="text-xs text-muted-foreground"
        >
          Admin API Access Token
        </Label>
        <Input
          id={`storeToken-${openId}`}
          type="password"
          value={draftToken}
          onChange={(e) => setDraftToken(e.target.value)}
          placeholder="shpka_xxxxxxxxxxxxxxxxxxxx"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleSave}>
          保存
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>
          取消
        </Button>
        {!isNew && openId && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => handleDelete(openId)}
          >
            删除店铺
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <Card className="border-border/50 shadow-sm">
      <CardContent className="space-y-5 px-6 py-5">
        {/* 顶栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-sm font-semibold">店铺配置</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              点击店铺行展开配置；勾选「源 /
              目标」指定业务页面使用的店铺，每家店铺限一个角色
            </p>
          </div>
          <Button
            size="sm"
            className="h-7 rounded-lg text-xs"
            onClick={startAdd}
            disabled={openId === NEW_ID}
          >
            + 添加店铺
          </Button>
        </div>

        {/* 店铺列表（折叠） */}
        <div className="space-y-1.5">
          {stores.length === 0 && openId !== NEW_ID && (
            <div className="rounded-lg border border-dashed border-border/50 px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                还没有店铺配置，点击「添加店铺」
              </p>
            </div>
          )}

          {stores.map((store) => (
            <div
              key={store.id}
              className="overflow-hidden rounded-lg border border-border/40"
            >
              {/* 组头 —— 点击展开/收起配置 */}
              <div
                onClick={() => toggleRow(store)}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors select-none hover:bg-muted/30"
              >
                <IconChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    openId === store.id ? "rotate-180" : ""
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{store.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {store.domain} · {maskToken(store.token)}
                  </p>
                </div>

                {/* 源 / 目标勾选（点这里不展开） */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex shrink-0 items-center gap-3"
                >
                  <div
                    onClick={() => toggleSource(store.id)}
                    className="flex cursor-pointer items-center gap-1"
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={sourceId === store.id}
                        onCheckedChange={() => toggleSource(store.id)}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground select-none">
                      源
                    </span>
                  </div>
                  <div
                    onClick={() => toggleTarget(store.id)}
                    className="flex cursor-pointer items-center gap-1"
                  >
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={targetId === store.id}
                        onCheckedChange={() => toggleTarget(store.id)}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground select-none">
                      目标
                    </span>
                  </div>
                </div>
              </div>

              {openId === store.id && renderForm(false)}
            </div>
          ))}

          {/* 新店铺草稿行 */}
          {openId === NEW_ID && (
            <div className="overflow-hidden rounded-lg border border-border/40">
              <div className="flex items-center gap-2.5 px-3 py-2.5 select-none">
                <IconChevronDown className="h-4 w-4 shrink-0 rotate-180 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {draftName.trim() || "新店铺"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {draftDomain.trim() || "填写域名和 Token 后保存"}
                  </p>
                </div>
              </div>
              {renderForm(true)}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
