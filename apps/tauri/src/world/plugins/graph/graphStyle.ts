/**
 * 图谱视觉策略纯函数（2026-10-09 图谱改进批 A）。
 *
 * 病：边曾一律 `rgba(255,255,255,0.12)` 1px——数据层 `GraphEdge` 早已带类型色 / `noArrow` /
 * `bidirectional` / `relLabel`（`canvas-engine/useGraphData`），渲染层全部丢弃，图谱呈「散沙」。
 * 本件把「关系元数据 → 边程序/颜色/线宽」与「缩放 → 标签阈值」收成纯函数，
 * 供 `useGraphModel` / `useSigmaRenderer` / `useGraphInteraction` 消费
 * （WebGL 画布无单测手段：策略直测 + 变异，视觉终审走真机走查）。
 */

export type EdgeProgram = 'line' | 'arrow' | 'double-arrow'

export interface EdgeVisualMeta {
  /** 关系类型色（hex，来自 `GraphEdge.coolColor`） */
  color: string
  /** 语义无向（关系中声明的 noArrow） */
  noArrow?: boolean
  /** 合并后双向（两向关系并存）或对称关系 */
  bidirectional?: boolean
  symmetric?: boolean
}

/** 方向语义：声明 noArrow → 无箭头；双向/对称 → 双箭头；其余 → 单箭头（有向关系） */
export function edgeProgramFor(meta: Pick<EdgeVisualMeta, 'noArrow' | 'bidirectional' | 'symmetric'>): EdgeProgram {
  if (meta.noArrow) return 'line'
  return meta.bidirectional || meta.symmetric ? 'double-arrow' : 'arrow'
}

/** 默认档透明度（深底 #0a0e14 上 0.12 近不可见，0.55 起「看得见」） */
export const EDGE_BASE_ALPHA = 0.55
/** 默认档线宽 */
export const EDGE_BASE_SIZE = 1.4
/** 高亮档（选中邻边 / 路径边）透明度与线宽 */
export const EDGE_HIGHLIGHT_ALPHA = 0.95
export const EDGE_HIGHLIGHT_SIZE = 2.4

/** `#rrggbb` → `rgba(r,g,b,a)`；非 6 位 hex 原样透传（注册表色均为 hex，透传仅作防御） */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export interface EdgeVisual {
  type: EdgeProgram
  color: string
  size: number
}

/** 默认档边视觉（组装/增量更新写 graphology 用） */
export function edgeBaseVisual(meta: EdgeVisualMeta): EdgeVisual {
  return { type: edgeProgramFor(meta), color: withAlpha(meta.color, EDGE_BASE_ALPHA), size: EDGE_BASE_SIZE }
}

/** 高亮档边视觉（选中节点邻边 / 路径边；`useGraphInteraction` 消费） */
export function edgeHighlightVisual(meta: EdgeVisualMeta): EdgeVisual {
  return { type: edgeProgramFor(meta), color: withAlpha(meta.color, EDGE_HIGHLIGHT_ALPHA), size: EDGE_HIGHLIGHT_SIZE }
}

/**
 * 标签阈值（sigma `labelRenderedSizeThreshold`：节点渲染尺寸 ≥ 阈值才显名）——
 * 缩放进 → 阈值降 → 小节点逐步显名（远看只标大节点、放大后全标）。
 * `ratio` 语义：sigma 相机 ratio（1 = 100%，越小越放大）。
 */
export function labelThresholdFor(ratio: number): number {
  if (ratio >= 1.2) return 9
  if (ratio >= 0.6) return 7
  return 4
}

/** 搜索匹配（批 B）：名称大小写不敏感包含；空串 → 空集（调用方据此恢复全图） */
export function matchNodeIds(nodes: Array<{ id: string; name: string }>, query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return nodes.filter(n => n.name.toLowerCase().includes(q)).map(n => n.id)
}

/** tooltip 估尺寸（max-width 240 / 单行 ~2 行高；定位翻转用近似值即可） */
export const TOOLTIP_W = 240
export const TOOLTIP_H = 56

/** tooltip 跟随定位（批 B）：指针右下 14px；近右/下缘翻到指针另一侧；左上保底 8px。
 *  坐标与 viewportW/H 同空间——图谱内传入 sigma 容器相对坐标 + 容器尺寸
 *  （走查反馈修：宿主 `contain: layout` 使 fixed 以容器为包含块，勿再按视口换算）。 */
export function tooltipPosition(
  x: number,
  y: number,
  viewportW: number,
  viewportH: number,
  w: number = TOOLTIP_W,
  h: number = TOOLTIP_H,
): { x: number; y: number } {
  const px = x + 14 + w > viewportW ? x - w - 14 : x + 14
  const py = y + 14 + h > viewportH ? y - h - 14 : y + 14
  return { x: Math.max(8, px), y: Math.max(8, py) }
}
