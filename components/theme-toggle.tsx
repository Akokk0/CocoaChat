"use client"

import { useSyncExternalStore } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

// 三态循环：system → light → dark → system
// 一旦用户调用 setTheme("light" | "dark")，next-themes 就把这个值锁进 localStorage，
// 之后系统切换不会再生效。提供 "system" 这第三档，
// 用户随时能"逃回跟随系统"——这是二态切换最大的痛点。
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

// useSyncExternalStore 的两个 snapshot：必须是稳定引用，否则 React 每次渲染都判断"值变了"重读。
// 模块级常量是天然稳定的。
const subscribeNoop = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

// 用 useSyncExternalStore 读"是否已挂载"。
// 老写法是 useEffect(() => setMounted(true), [])——React 19 的 set-state-in-effect lint
// 抓的就是这种"在 effect 里同步 setState 触发 cascading rerender"。
// useSyncExternalStore 是 React 官方为"读跨 SSR/CSR 边界的外部状态"准备的 hook：
//   - server 渲染期：用 getServerSnapshot 拿 false
//   - client hydrate 后：用 getClientSnapshot 拿 true
// React 自己处理 hydration 的切换，没有 effect → setState 的二次渲染。
function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    getClientSnapshot,
    getServerSnapshot,
  )
}

export function ThemeToggle() {
  // theme 是用户的"设定"（可能是 "system" / "light" / "dark"）；
  // resolvedTheme 是把 "system" 解析后的实际值。
  // 三态切换里我们关心的是用户设定，所以读 theme 而不是 resolvedTheme。
  const { theme, setTheme } = useTheme()

  // 关键：处理 SSR/Hydration 不匹配。
  // 服务端不知道用户偏好，首次渲染时给一个无实际指向的占位；
  // hydrate 后再切到真实图标。
  const mounted = useHasMounted()

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon-sm" aria-hidden disabled>
        <Monitor className="size-4" />
      </Button>
    )
  }

  // theme 可能是 undefined（极早期）或自定义值，做个回退保护
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
