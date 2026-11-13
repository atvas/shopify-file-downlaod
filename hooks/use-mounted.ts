"use client"

import { useSyncExternalStore } from "react"

const emptySubscribe = () => () => {}

/**
 * 挂载标记。localStorage 派生的 UI 用它避开 hydration 不一致：
 * 服务端快照 false（渲染占位），挂载后切到客户端快照 true（渲染真实内容）。
 * 用 useSyncExternalStore 而不是 effect+setState —— React 保证 hydration 帧
 * 用服务端快照、随后自动重渲染，没有级联渲染，也不触发 set-state-in-effect。
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
}
