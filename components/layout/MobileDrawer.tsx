"use client"

// 移动端左侧抽屉。直接用 base-ui Dialog primitive 拼装（shadcn dialog 写死了居中变换不好改成侧拉），
// 自带 focus trap / Esc 关闭，动画交给 tw-animate-css 的 data-open/data-closed。

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
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          aria-label="导航"
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-72 flex-col",
            "bg-sidebar text-sidebar-foreground shadow-xl outline-none",
            "data-open:animate-in data-open:slide-in-from-left data-open:fade-in-0",
            "data-closed:animate-out data-closed:slide-out-to-left data-closed:fade-out-0",
          )}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
