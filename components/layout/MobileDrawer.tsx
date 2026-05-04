"use client"

// 移动端的左侧抽屉。
// 用 base-ui Dialog primitive 直接拼——shadcn 的 ui/dialog.tsx 写死了"居中弹窗"
// 的 transform，套在它上面想做侧拉很别扭，重新组装更短。
//
// 动画走 tw-animate-css 的 slide-in-from-left / slide-out-to-left：
// base-ui 的 data-open / data-closed 属性是动画状态切换的根据，配合 animate-in / animate-out
// 自动跑入场和出场——不需要 framer-motion / AnimatePresence。
//
// a11y：base-ui Dialog 内置 focus trap、Esc 关闭、tab 边界处理——
// 自己用 motion + div 做要补一长串 ARIA，不划算。

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

export function MobileDrawer({ open, onOpenChange, children }: Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-40 bg-black/40 supports-backdrop-filter:backdrop-blur-xs",
            // 出现/消失淡入淡出。duration 由 --animate-in / --animate-out 默认值控制。
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          aria-label="导航"
          className={cn(
            // 占满左侧 w-72 全高，比 Sidebar 桌面态 w-64 略宽——移动端可点区域更舒服。
            "fixed inset-y-0 left-0 z-50 flex w-72 flex-col",
            // 颜色用 sidebar 主题变量，跟桌面端一致。
            "bg-sidebar text-sidebar-foreground shadow-xl outline-none",
            // 入场：从左滑入 + 淡入。
            "data-open:animate-in data-open:slide-in-from-left data-open:fade-in-0",
            // 出场：相反方向。
            "data-closed:animate-out data-closed:slide-out-to-left data-closed:fade-out-0",
          )}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
