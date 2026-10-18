/**
 * contextMenu —— 白板右键菜单的「落点解析」与「菜单构建」（**纯函数**，可单测）
 *
 * 【设计原则（09-17 负责人拍板）】
 * ① 右键菜单**不是工具条的副本**：只放「上下文就近」与「没有常驻入口」的动作。
 * ② 严格按落点分流，一级上下文一套菜单，不做「万能大菜单」。
 * ③ 危险动作永远最后 + `danger`（由组件标红）。
 *
 * 【为什么白板比别的芽更需要它】（三条，都是白板特有）
 * · 白板是唯一会**缩放**的视图——缩到 40% 时容器头上那些 16px 小按钮已经点不准，
 *   而右键菜单的命中区域是整块容器；
 * · 属性面板可关闭（`inspectorClosed`）——关掉后容器尺寸/自适应/组件排序就**全无入口**；
 * · 多个关键交互是**隐藏的**（双击空白新建、双击区标题改名）——右键菜单是它们的可发现性出口。
 *
 * 【落点约定】可右键的元素标注 `data-ctx`（层级）+ `data-ctx-id`（标识），
 * 解析时用 `closest` 取**最内层**（组件行 > 容器 > 区 > 画布空白）。
 */
import type { SnapMode } from './composables/useBoardSnap'

export type ContextTarget =
  | { kind: 'canvas' }
  | { kind: 'section'; id: string }
  | { kind: 'container'; id: string }
  | { kind: 'component'; containerId: string; componentId: string }
  /** 右栏节点行（2026-10-19）：不落在画布上，只有「删除节点」一个动作 */
  | { kind: 'node'; id: string }

/** 构建菜单所需的上下文状态（由装配层从 store / 布局体读出） */
export interface ContextState {
  gridEnabled: boolean
  snapMode: SnapMode
  /** 该容器是否悬空（节点已删） */
  dangling: boolean
  hasManuscript: boolean
  collapsed: boolean
  /** 未设显式尺寸 = 内容自适应（此时「恢复自适应」应禁用） */
  autoSized: boolean
  isFirstComponent: boolean
  isLastComponent: boolean
}

export const DEFAULT_CONTEXT_STATE: ContextState = {
  gridEnabled: false,
  snapMode: 'guides',
  dangling: false,
  hasManuscript: false,
  collapsed: false,
  autoSized: true,
  isFirstComponent: false,
  isLastComponent: false,
}

export interface MenuItem {
  id: string
  label: string
  /** 右侧快捷键提示（与注册表一致时才写，避免出现「菜单写了但按不动」） */
  keys?: string
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  /** 在该项**之前**插入分隔线 */
  sep?: boolean
}

export const CTX_ATTR = 'data-ctx'

/** DOM → 落点。无标注一律视为「画布空白」，故画布无需额外处理 */
export function resolveContextTarget(el: Element | null): ContextTarget {
  if (!el) return { kind: 'canvas' }
  const hit = el.closest(`[${CTX_ATTR}]`)
  if (!hit) return { kind: 'canvas' }

  const kind = hit.getAttribute(CTX_ATTR)
  const id = hit.getAttribute('data-ctx-id') ?? ''

  if (kind === 'component') {
    // 组件行的容器要从祖先读（组件行自身只带 componentId，避免两处 id 冗余）
    const box = hit.closest(`[${CTX_ATTR}="container"]`)
    const containerId = box?.getAttribute('data-ctx-id') ?? ''
    if (!containerId || !id) return { kind: 'canvas' }
    return { kind: 'component', containerId, componentId: id }
  }
  if (kind === 'container' && id) return { kind: 'container', id }
  if (kind === 'section' && id) return { kind: 'section', id }
  return { kind: 'canvas' }
}

/** 菜单项 id → 是否作用于**容器**（装配层据此定位容器；避免在装配层再写一遍 kind 判定） */
export function containerIdOfTarget(target: ContextTarget): string | null {
  if (target.kind === 'container') return target.id
  if (target.kind === 'component') return target.containerId
  return null
}

/**
 * 按落点构建菜单项。
 * 悬空容器（节点已删）只留「清理此容器」——这才是上下文菜单该有的正确性：
 * 其余项（打开正文 / 定位 / 加形式…）对一个没有节点的容器毫无意义。
 */
export function buildMenuItems(target: ContextTarget, state: ContextState): MenuItem[] {
  if (target.kind === 'node') {
    return [{ id: 'delete-node', label: '删除节点…', danger: true }]
  }
  if (target.kind === 'canvas') {
    return [
      { id: 'new-node', label: '新建节点并放置' },
      { id: 'fit-all', label: '适配全部', keys: 'Shift+1', sep: true },
      { id: 'zoom-100', label: '缩放至 100%' },
      { id: 'toggle-grid', label: '显示网格', checked: state.gridEnabled, sep: true },
      { id: 'snap-off', label: '吸附：关闭', checked: state.snapMode === 'off' },
      { id: 'snap-grid', label: '吸附：网格', checked: state.snapMode === 'grid' },
      { id: 'snap-guides', label: '吸附：辅助线', checked: state.snapMode === 'guides' },
    ]
  }

  if (target.kind === 'section') {
    return [
      { id: 'rename-section', label: '重命名区' },
      { id: 'rearrange-section', label: '重排区内容器' },
      { id: 'fit-section', label: '适配到该区' },
      { id: 'remove-section', label: '删除区', danger: true, sep: true },
    ]
  }

  if (target.kind === 'component') {
    return [
      { id: 'focus-inspector', label: '在属性面板中配置' },
      {
        id: 'move-component-up',
        label: '上移',
        disabled: state.isFirstComponent,
        sep: true,
      },
      { id: 'move-component-down', label: '下移', disabled: state.isLastComponent },
      { id: 'remove-component', label: '移除该形式', danger: true, sep: true },
    ]
  }

  if (state.dangling) {
    return [{ id: 'remove-container', label: '清理此容器（节点已删除）', danger: true }]
  }
  return [
    {
      id: 'open-manuscript',
      label: '打开正文',
      disabled: !state.hasManuscript,
    },
    { id: 'reveal-in-sidebar', label: '在右栏中定位' },
    { id: 'add-form', label: '添加表现形式' },
    { id: 'toggle-collapse', label: state.collapsed ? '展开' : '折叠', sep: true },
    { id: 'reset-size', label: '恢复内容自适应', disabled: state.autoSized },
    { id: 'remove-container', label: '移除出画布', sep: true },
    { id: 'delete-node', label: '删除节点…', danger: true },
  ]
}

/** 菜单不出视口：右下越界时向左/向上翻（照 GlobalEditMenu 的做法，抽成纯函数以便测试） */
export function clampMenuPosition(
  x: number,
  y: number,
  menu: { w: number; h: number },
  viewport: { w: number; h: number },
): { x: number; y: number } {
  const margin = 4
  const maxX = Math.max(margin, viewport.w - menu.w - margin)
  const maxY = Math.max(margin, viewport.h - menu.h - margin)
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  }
}

/** 键盘导航：在**未禁用**项之间移动（菜单无障碍；-1 表示当前无高亮） */
export function nextEnabledIndex(items: MenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length
  if (!n) return -1
  // from < 0 = 「尚未高亮」：向下从首项起、向上从**末项**起。
  // （若直接算 (from + dir + n) % n，按 ↑ 会从中间项开始，不符合「第一次按键跳到边界」的直觉）
  let i = from < 0 ? (dir === 1 ? -1 : n) : from
  for (let step = 0; step < n; step += 1) {
    i = (i + dir + n) % n
    if (!items[i].disabled) return i
  }
  return -1
}
