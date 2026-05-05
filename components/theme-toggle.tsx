"use client"

import { useSyncExternalStore } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// 三态循环 system → light → dark：保留 system 档让用户随时回到"跟随系统"。
const NEXT_THEME = {
  system: "light",
  light: "dark",
  dark: "system",
} as const

const LABELS = {
  system: { current: "跟随系统", next: "切换到亮色" },
  light: { current: "亮色模式", next: "切换到暗色" },
  dark: { current: "暗色模式", next: "切换到跟随系统" },
} as const

// 三个 snapshot 必须是稳定引用，否则 useSyncExternalStore 每次渲染都判定"值变了"重读。
const subscribeNoop = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

// 用 useSyncExternalStore 读"是否已挂载"——避开 React 19 的 set-state-in-effect lint。
function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    getClientSnapshot,
    getServerSnapshot,
  )
}

export function ThemeToggle() {
  // 三态切换关心的是用户"设定值"而不是解析后的实际颜色，所以用 theme 不用 resolvedTheme。
  const { theme, setTheme } = useTheme()

  // SSR 不知道用户偏好，未挂载先渲染占位再切真实图标。
  const mounted = useHasMounted()

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon-sm" aria-hidden disabled>
        <Monitor className="size-4" />
      </Button>
    )
  }

  const current = (theme ?? "system") as keyof typeof NEXT_THEME
  const safe = current in NEXT_THEME ? current : "system"
  const next = NEXT_THEME[safe]
  const { current: currentLabel, next: nextLabel } = LABELS[safe]

  const Icon = safe === "system" ? Monitor : safe === "dark" ? Moon : Sun

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTheme(next)}
            aria-label={nextLabel}
          >
            <Icon className="size-4" />
          </Button>
        }
      />
      <TooltipContent>
        当前：{currentLabel} · {nextLabel}
      </TooltipContent>
    </Tooltip>
  )
}
