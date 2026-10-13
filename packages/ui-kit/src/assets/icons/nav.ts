import type { IconDef } from './types'

/**
 * 导航 / 工作台图标（来自 Tauri 端原 TuiIcon 线性图标集，2026-08-10 合并）。
 * 迁移来源：apps/tauri/src/components/ui/TuiIcon.vue（已废弃删除）；仅收录注册表中不存在、
 * 且工作台实际用到的图标，path 原样保留保证视觉不变；与已有同名图标不重复注册。
 */
export const navIcons: Record<string, IconDef> = {
  chat: { d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z', category: 'nav' },
  terminal: { d: 'M4 17l6-6-6-6M12 19h8', category: 'nav' },
  subagent: { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75', category: 'nav' },
  memory: { d: 'M12 5c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3', category: 'nav' },
  send: { d: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z', category: 'nav' },
  stop: { d: 'M7 7h10v10H7z', category: 'nav' },
  plus: { d: 'M12 5v14M5 12h14', category: 'nav' },
  bulb: { d: 'M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7zM9 21h6', category: 'nav' },
  info: { d: 'M12 12v6M12 8v.5M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', category: 'nav' },
  'arrow-left': { d: 'M19 12H5M12 19l-7-7 7-7', category: 'nav' },
  trash: { d: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6', category: 'nav' },
  copy: { d: 'M8 8h12v12H8zM4 16V4a1 1 0 0 1 1-1h12', category: 'nav' },
  sparkle: { d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z', category: 'nav' },
  dots: { d: 'M5 12h.01M12 12h.01M19 12h.01', category: 'nav' },
  book: { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z', category: 'nav' },
  wrench: { d: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-3.1 3.1-2.3-2.3 3.4-3.1zM12 9l3-3', category: 'nav' },
  grid: { d: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', category: 'nav' },
  moon: { d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', category: 'nav' },
  sun: { d: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4', category: 'nav' },
  upload: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12', category: 'nav' },
  file: { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6', category: 'nav' },
  monitor: { d: 'M3 4h18v12H3zM8 20h8M12 16v4', category: 'nav' },
  video: { d: 'M23 7l-7 5 7 5V7zM1 5h15v14H1z', category: 'nav' },
  paperclip: { d: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48', category: 'nav' },
  tree: { d: 'M12 22v-8M12 14a4 4 0 1 0-4-4M12 14a4 4 0 1 1 4-4M12 10v4', category: 'nav' },
  download: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', category: 'nav' },
  package: { d: 'M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12', category: 'nav' },
  activity: { d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.5.5 0 0 1-.96.04L9.3 2.26a.5.5 0 0 0-.96-.04L6.23 8.54A2 2 0 0 1 4.3 10H2', category: 'nav' },
  chart: { d: 'M3 3v18h18M7 14l3-3 3 3 5-6', category: 'nav' },
  task: { d: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01', category: 'nav' },
}
