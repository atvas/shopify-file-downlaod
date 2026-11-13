import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

/**
 * 是否处于移动宽度（< 768px）。
 * 用 useSyncExternalStore 而不是 effect+setState：无级联渲染、不触发
 * set-state-in-effect，SSR 快照为 false（与 hooks/use-mounted.ts 同一手法）。
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false
  )
}
