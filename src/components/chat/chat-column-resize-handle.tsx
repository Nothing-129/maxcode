"use client"

// src/components/chat/chat-column-resize-handle.tsx
//
// 会话内容列（.maxcode-chat-column）右缘的拖宽抓手。参照印象青城参考端的交互：
// 平时完全隐形，只有指针移到列缘热区上才浮现发丝线 + 竖排 grip；拖动中保持可见，
// 双击恢复默认 48rem。列本身始终居中（mx-auto），所以列右缘在父容器上的位置可以
// 纯 CSS 推导：50% + min(var(--chat-column-max)/2, 50%)，与列的实际取宽逻辑
// （width:100% + max-width）逐像素一致，不需要 ResizeObserver 对齐。
//
// 定位前提：挂在会话区那个 `relative` 的内容容器里（workspace/layout.tsx），
// 且该容器宽度 === 列的包含块宽度（中间都是 w-full 链路）。

import { useCallback, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { useChatColumnWidth } from "@/hooks/use-appearance"
import {
  DEFAULT_CHAT_COLUMN_WIDTH_REM,
  MAX_CHAT_COLUMN_WIDTH_REM,
  MIN_CHAT_COLUMN_WIDTH_REM,
} from "@/lib/chat-column-width"
import { cn } from "@/lib/utils"

export function ChatColumnResizeHandle() {
  const t = useTranslations("Folder.chat.columnResize")
  const { chatColumnWidth, setChatColumnWidth } = useChatColumnWidth()
  const [dragging, setDragging] = useState(false)
  // 渐隐竖线跟随指针的垂直位置（参考端交互：光标到哪线到哪）。位置与显隐分离：
  // lineY 保留最后一次指针位置，离开热区只翻 lineVisible —— top 不回中，否则
  // 在顶部/底部钳制位挪开时，会看到线跳到中间闪一下再消失（用户实测反馈）。
  const [lineY, setLineY] = useState<number | null>(null)
  const [lineVisible, setLineVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStart = useRef<{
    x: number
    widthPx: number
    rootFontPx: number
  } | null>(null)

  const trackPointerY = useCallback((clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setLineY(Math.min(Math.max(clientY - rect.top, 88), rect.height - 88))
    setLineVisible(true)
  }, [])

  // 列居中、双缘随拖动对称伸缩：列宽变化量 = 指针位移 × 2，抓手恰好跟手。
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const rootFontPx = parseFloat(
        getComputedStyle(document.documentElement).fontSize
      )
      dragStart.current = {
        x: e.clientX,
        widthPx: chatColumnWidth * rootFontPx,
        rootFontPx,
      }
      setDragging(true)
      trackPointerY(e.clientY)
    },
    [chatColumnWidth, trackPointerY]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      trackPointerY(e.clientY)
      const start = dragStart.current
      if (!start) return
      const nextPx = start.widthPx + (e.clientX - start.x) * 2
      setChatColumnWidth(nextPx / start.rootFontPx)
    },
    [setChatColumnWidth, trackPointerY]
  )

  const endDrag = useCallback(() => {
    dragStart.current = null
    setDragging(false)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step =
        e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : e.key === "ArrowRight" || e.key === "ArrowUp"
            ? 1
            : 0
      if (step !== 0) {
        e.preventDefault()
        setChatColumnWidth(chatColumnWidth + step)
        return
      }
      if (e.key === "Home") {
        e.preventDefault()
        setChatColumnWidth(MIN_CHAT_COLUMN_WIDTH_REM)
      } else if (e.key === "End") {
        e.preventDefault()
        setChatColumnWidth(MAX_CHAT_COLUMN_WIDTH_REM)
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        setChatColumnWidth(DEFAULT_CHAT_COLUMN_WIDTH_REM)
      }
    },
    [chatColumnWidth, setChatColumnWidth]
  )

  return (
    <div
      ref={containerRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("label")}
      title={`${t("label")} · ${t("reset")}`}
      aria-valuenow={chatColumnWidth}
      aria-valuemin={MIN_CHAT_COLUMN_WIDTH_REM}
      aria-valuemax={MAX_CHAT_COLUMN_WIDTH_REM}
      aria-valuetext={`${chatColumnWidth}rem`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerEnter={(e) => trackPointerY(e.clientY)}
      onPointerLeave={() => setLineVisible(false)}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => setChatColumnWidth(DEFAULT_CHAT_COLUMN_WIDTH_REM)}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 z-30 w-4 -translate-x-1/2 cursor-col-resize touch-none"
      // 列右缘 = 容器中线 + 实际列宽的一半；实际列宽 = min(--chat-column-max,
      // 容器宽)，与 .maxcode-chat-column 的取宽逻辑一致。内联 style 而非 Tailwind
      // 任意值：calc 的 + 两侧必须留空白，任意值下划线转义极易踩坑。
      style={{
        left: "calc(50% + min(var(--chat-column-max, 48rem) / 2, 50%))",
      }}
    >
      {/* 渐隐细线（2×120px：浅灰、上下两端长距离渐隐），跟随指针垂直位置；
          渐变在 globals.css 的 .chat-column-edge-line（用 --foreground 适配
          明暗）。唯一的浮现视觉，热区本身不可见。 */}
      <span
        aria-hidden
        className={cn(
          "chat-column-edge-line absolute left-1/2 h-[120px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full",
          "transition-opacity duration-150",
          dragging || lineVisible
            ? "opacity-100"
            : "opacity-0 group-focus-visible:opacity-100"
        )}
        style={{ top: lineY ?? "50%" }}
      />
    </div>
  )
}
