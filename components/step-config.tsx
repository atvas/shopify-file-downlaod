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
  STORAGE_KEY,
  LAST_USED_KEY,
  getSavedConfigsFromStorage,
  getLastUsedConfigFromStorage,
} from "@/lib/types"
import { IconChevronDown } from "@/components/icons"

interface StepConfigProps {
  onConfigChange: (domain: string, token: string) => void
  onError: (msg: string) => void
}

export function StepConfig({ onConfigChange, onError }: StepConfigProps) {
  const [configExpanded, setConfigExpanded] = useState(true)
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState("")
  const [storeDomain, setStoreDomain] = useState("")
  const [accessToken, setAccessToken] = useState("")
  const [configName, setConfigName] = useState("")

  // 初始化：从 localStorage 恢复配置
  useEffect(() => {
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const isConfigured = !!storeDomain && !!accessToken

  return (
    <Card className="overflow-hidden border-border/50 shadow-sm">
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
        <CardContent className="space-y-4 border-t px-6 pt-5 pb-6">
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
                  <SelectValue placeholder="选择或新建配置" />
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
        </CardContent>
      )}
    </Card>
  )
}
