"use client"

import { useState, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  type SavedConfig,
  type TargetConfig,
  STORAGE_KEY,
  LAST_USED_KEY,
  TARGET_CONFIGS_KEY,
  TARGET_LAST_USED_KEY,
  getSavedConfigsFromStorage,
  getLastUsedConfigFromStorage,
  getTargetConfigsFromStorage,
  getLastUsedTargetFromStorage,
} from "@/lib/types"
import { IconChevronDown } from "@/components/icons"

interface StepConfigProps {
  onConfigChange: (domain: string, token: string) => void
  onTargetChange: (domain: string, token: string) => void
  onError: (msg: string) => void
}

export function StepConfig({
  onConfigChange,
  onTargetChange,
  onError,
}: StepConfigProps) {
  // ── 源站点配置 ───────────────────────────────────────────────────────
  const [configExpanded, setConfigExpanded] = useState(true)
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState("")
  const [storeDomain, setStoreDomain] = useState("")
  const [accessToken, setAccessToken] = useState("")
  const [configName, setConfigName] = useState("")

  // ── 目标站点配置 ─────────────────────────────────────────────────────
  const [targetExpanded, setTargetExpanded] = useState(false)
  const [targetConfigs, setTargetConfigs] = useState<TargetConfig[]>([])
  const [selectedTargetId, setSelectedTargetId] = useState("")
  const [targetDomain, setTargetDomain] = useState("")
  const [targetToken, setTargetToken] = useState("")
  const [targetName, setTargetName] = useState("")

  // ── 初始化 ───────────────────────────────────────────────────────────
  useEffect(() => {
    // 源站点
    const configs = getSavedConfigsFromStorage()
    setSavedConfigs(configs)
    const lastConfig = getLastUsedConfigFromStorage()
    if (lastConfig) {
      setSelectedConfigId(lastConfig.id)
      setStoreDomain(lastConfig.storeDomain)
      setAccessToken(lastConfig.accessToken)
      setConfigName(lastConfig.name)
      setConfigExpanded(false)
      onConfigChange(lastConfig.storeDomain, lastConfig.accessToken)
    }
    // 目标站点
    const tConfigs = getTargetConfigsFromStorage()
    setTargetConfigs(tConfigs)
    const lastTarget = getLastUsedTargetFromStorage()
    if (lastTarget) {
      setSelectedTargetId(lastTarget.id)
      setTargetDomain(lastTarget.domain)
      setTargetToken(lastTarget.token)
      setTargetName(lastTarget.name)
      setTargetExpanded(false)
      onTargetChange(lastTarget.domain, lastTarget.token)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 源站点配置操作 ───────────────────────────────────────────────────
  const saveConfigs = useCallback((configs: SavedConfig[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
      setSavedConfigs(configs)
    } catch {
      console.error("Failed to save configs")
    }
  }, [])

  const handleSelectConfig = useCallback(
    (id: string | null) => {
      const configId = id || ""
      setSelectedConfigId(configId)
      if (configId === "" || configId === "__new__") {
        setStoreDomain("")
        setAccessToken("")
        setConfigName("")
        setSelectedConfigId("")
        localStorage.removeItem(LAST_USED_KEY)
        onConfigChange("", "")
        return
      }
      const config = savedConfigs.find((c) => c.id === configId)
      if (config) {
        setStoreDomain(config.storeDomain)
        setAccessToken(config.accessToken)
        setConfigName(config.name)
        localStorage.setItem(LAST_USED_KEY, configId)
        onConfigChange(config.storeDomain, config.accessToken)
      }
    },
    [savedConfigs, onConfigChange],
  )

  const handleSaveConfig = useCallback(() => {
    if (!storeDomain || !accessToken) {
      onError("请填写店铺域名和 API Token")
      return
    }
    const name = configName || storeDomain
    const id = selectedConfigId || Date.now().toString()
    const newConfig: SavedConfig = {
      id,
      name,
      storeDomain,
      accessToken,
    }
    const existingIndex = savedConfigs.findIndex((c) => c.id === id)
    let newConfigs: SavedConfig[]
    if (existingIndex >= 0) {
      newConfigs = [...savedConfigs]
      newConfigs[existingIndex] = newConfig
    } else {
      newConfigs = [...savedConfigs, newConfig]
    }
    saveConfigs(newConfigs)
    setSelectedConfigId(id)
    setConfigName(name)
    localStorage.setItem(LAST_USED_KEY, id)
    onConfigChange(storeDomain, accessToken)
  }, [
    storeDomain,
    accessToken,
    configName,
    selectedConfigId,
    savedConfigs,
    saveConfigs,
    onConfigChange,
    onError,
  ])

  const handleDeleteConfig = useCallback(() => {
    if (!selectedConfigId) return
    const newConfigs = savedConfigs.filter((c) => c.id !== selectedConfigId)
    saveConfigs(newConfigs)
    setSelectedConfigId("")
    setStoreDomain("")
    setAccessToken("")
    setConfigName("")
    localStorage.removeItem(LAST_USED_KEY)
    onConfigChange("", "")
  }, [selectedConfigId, savedConfigs, saveConfigs, onConfigChange])

  // ── 目标站点配置操作 ─────────────────────────────────────────────────
  const saveTargetConfigs = useCallback((configs: TargetConfig[]) => {
    try {
      localStorage.setItem(TARGET_CONFIGS_KEY, JSON.stringify(configs))
      setTargetConfigs(configs)
    } catch {
      console.error("Failed to save target configs")
    }
  }, [])

  const handleSelectTarget = useCallback(
    (id: string | null) => {
      const targetId = id || ""
      setSelectedTargetId(targetId)
      if (targetId === "" || targetId === "__new__") {
        setTargetDomain("")
        setTargetToken("")
        setTargetName("")
        setSelectedTargetId("")
        localStorage.removeItem(TARGET_LAST_USED_KEY)
        onTargetChange("", "")
        return
      }
      if (targetId === "__none__") {
        setTargetDomain("")
        setTargetToken("")
        setTargetName("")
        setSelectedTargetId("")
        localStorage.removeItem(TARGET_LAST_USED_KEY)
        onTargetChange("", "")
        return
      }
      const config = targetConfigs.find((c) => c.id === targetId)
      if (config) {
        setTargetDomain(config.domain)
        setTargetToken(config.token)
        setTargetName(config.name)
        localStorage.setItem(TARGET_LAST_USED_KEY, targetId)
        onTargetChange(config.domain, config.token)
      }
    },
    [targetConfigs, onTargetChange],
  )

  const handleSaveTarget = useCallback(() => {
    if (!targetDomain || !targetToken) {
      onError("请填写目标站点域名和 Token")
      return
    }
    const name = targetName || targetDomain
    const id = selectedTargetId || Date.now().toString()
    const newConfig: TargetConfig = {
      id,
      name,
      domain: targetDomain,
      token: targetToken,
    }
    const existingIndex = targetConfigs.findIndex((c) => c.id === id)
    let newConfigs: TargetConfig[]
    if (existingIndex >= 0) {
      newConfigs = [...targetConfigs]
      newConfigs[existingIndex] = newConfig
    } else {
      newConfigs = [...targetConfigs, newConfig]
    }
    saveTargetConfigs(newConfigs)
    setSelectedTargetId(id)
    setTargetName(name)
    localStorage.setItem(TARGET_LAST_USED_KEY, id)
    onTargetChange(targetDomain, targetToken)
  }, [
    targetDomain,
    targetToken,
    targetName,
    selectedTargetId,
    targetConfigs,
    saveTargetConfigs,
    onTargetChange,
    onError,
  ])

  const handleDeleteTarget = useCallback(() => {
    if (!selectedTargetId) return
    const newConfigs = targetConfigs.filter((c) => c.id !== selectedTargetId)
    saveTargetConfigs(newConfigs)
    setSelectedTargetId("")
    setTargetDomain("")
    setTargetToken("")
    setTargetName("")
    localStorage.removeItem(TARGET_LAST_USED_KEY)
    onTargetChange("", "")
  }, [selectedTargetId, targetConfigs, saveTargetConfigs, onTargetChange])

  const isConfigured = !!storeDomain && !!accessToken
  const isTargetConfigured = !!targetDomain && !!targetToken

  return (
    <Card className="overflow-hidden border-border/50 shadow-sm">
      {/* ── 源站点配置 ───────────────────────────────────────────────── */}
      <button
        onClick={() => setConfigExpanded((p) => !p)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
            1
          </span>
          <div>
            <CardTitle className="text-sm">API 配置</CardTitle>
            {!configExpanded && isConfigured && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {configName || storeDomain}
              </p>
            )}
          </div>
        </div>
        <IconChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            configExpanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {configExpanded && (
        <CardContent className="space-y-6 border-t px-6 pt-5 pb-6">
          {/* 源站点 */}
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground">
              源站点（素材读取）
            </p>

            {savedConfigs.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  已保存配置
                </Label>
                 <Select
                  value={selectedConfigId}
                  onValueChange={handleSelectConfig}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择或新建配置">
                      {(value) =>
                        value === "__new__"
                          ? "+ 新建配置"
                          : savedConfigs.find((c) => c.id === value)?.name ??
                            value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__">+ 新建配置</SelectItem>
                    {savedConfigs.map((config) => (
                      <SelectItem key={config.id} value={config.id}>
                        {config.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label
                  htmlFor="configName"
                  className="text-xs text-muted-foreground"
                >
                  配置名称
                </Label>
                <Input
                  id="configName"
                  value={configName}
                  onChange={(e) => setConfigName(e.target.value)}
                  placeholder="可选"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="storeDomain"
                  className="text-xs text-muted-foreground"
                >
                  店铺域名
                </Label>
                <Input
                  id="storeDomain"
                  value={storeDomain}
                  onChange={(e) => setStoreDomain(e.target.value)}
                  placeholder="xxx.myshopify.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="accessToken"
                className="text-xs text-muted-foreground"
              >
                Admin API Access Token
              </Label>
              <Input
                id="accessToken"
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="shpka_xxxxxxxxxxxxxxxxxxxx"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSaveConfig} size="sm">
                保存配置
              </Button>
              {selectedConfigId && (
                <Button
                  onClick={handleDeleteConfig}
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                >
                  删除
                </Button>
              )}
            </div>
          </div>

          {/* 分隔线 */}
          <div className="border-t" />

          {/* 目标站点（可选） */}
          <div className="space-y-4">
            <button
              onClick={() => setTargetExpanded((p) => !p)}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  目标站点（可选，用于推送图片到目标站点）
                </p>
                {isTargetConfigured && !targetExpanded && (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    已配置
                  </span>
                )}
              </div>
              <IconChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                  targetExpanded ? "rotate-180" : ""
                }`}
              />
            </button>

            {targetExpanded && (
              <div className="space-y-4">
                {targetConfigs.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      已保存目标站点
                    </Label>
                    <Select
                      value={selectedTargetId}
                      onValueChange={handleSelectTarget}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择目标站点">
                          {(value) =>
                            value === "__none__"
                              ? "不使用"
                              : value === "__new__"
                                ? "+ 新建"
                                : targetConfigs.find((c) => c.id === value)
                                    ?.name ?? value
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">不使用</SelectItem>
                        <SelectItem value="__new__">+ 新建</SelectItem>
                        {targetConfigs.map((config) => (
                          <SelectItem key={config.id} value={config.id}>
                            {config.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="targetName"
                      className="text-xs text-muted-foreground"
                    >
                      配置名称
                    </Label>
                    <Input
                      id="targetName"
                      value={targetName}
                      onChange={(e) => setTargetName(e.target.value)}
                      placeholder="可选"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="targetDomain"
                      className="text-xs text-muted-foreground"
                    >
                      目标域名
                    </Label>
                    <Input
                      id="targetDomain"
                      value={targetDomain}
                      onChange={(e) => setTargetDomain(e.target.value)}
                      placeholder="xxx.myshopify.com"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="targetToken"
                    className="text-xs text-muted-foreground"
                  >
                    目标 Admin API Token
                  </Label>
                  <Input
                    id="targetToken"
                    type="password"
                    value={targetToken}
                    onChange={(e) => setTargetToken(e.target.value)}
                    placeholder="shpka_xxxxxxxxxxxxxxxxxxxx"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button onClick={handleSaveTarget} size="sm">
                    保存目标
                  </Button>
                  {selectedTargetId && (
                    <Button
                      onClick={handleDeleteTarget}
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                    >
                      删除
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
