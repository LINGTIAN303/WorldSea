<script setup lang="ts">
/**
 * TuiIcon：Tauri 端统一线性 SVG 图标集
 *
 * 集中管理全端图标（stroke 风格，24 viewBox），供各组件以 `name` 引用，
 * 消除各页面内联散落的 <path> 定义，保证图标风格一致。
 * 详细why请见 docs/details/注释/tauri/components/TuiIcon.md
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    /** 描边宽度（默认 1.7，与既有风格一致） */
    strokeWidth?: number
  }>(),
  { size: 16, strokeWidth: 1.7 },
)

/** name → path 映射（fill="none" 描边风格） */
const PATHS: Record<string, string> = {
  // 导航
  chat: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  subagent: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  memory: 'M12 5c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3',
  // 操作
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  bulb: 'M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7zM9 21h6',
  check: 'M20 6L9 17l-5-5',
  warning: 'M12 3l10 18H2L12 3zM12 10v5M12 18.5v.5',
  info: 'M12 12v6M12 8v.5M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  search: 'M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6',
  copy: 'M8 8h12v12H8zM4 16V4a1 1 0 0 1 1-1h12',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  shield: 'M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4zM9 12l2 2 4-4',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-3.1 3.1-2.3-2.3 3.4-3.1zM12 9l3-3',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  // 附件（拖拽/粘贴上传，批次95）
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  // 主题三态（批次99）：system 模式显示器图标
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  // 附件区分（批次101）：图片附件图标
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6M14 8h.01',
  // Phase D 迁入面板（活动日志/计划/知识墙）补充图标（lucide 线性风格，与上保持一致）
  video: 'M23 7l-7 5 7 5V7zM1 5h15v14H1z',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z',
  folderOpen: 'M6 14l1.5-4.5A2 2 0 0 1 9.4 8H22l-2.5 6H6zM6 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  paperclip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  tree: 'M12 22v-8M12 14a4 4 0 1 0-4-4M12 14a4 4 0 1 1 4-4M12 10v4',
  package: 'M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
  // 执行面板三 Tab（lucide 线性风格，2026-08-09 重构新增）
  activity: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.5.5 0 0 1-.96.04L9.3 2.26a.5.5 0 0 0-.96-.04L6.23 8.54A2 2 0 0 1 4.3 10H2',
  chart: 'M3 3v18h18M7 14l3-3 3 3 5-6',
  task: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
}

const d = computed(() => PATHS[props.name] ?? '')
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="d" />
  </svg>
</template>
