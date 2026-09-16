/**
 * layoutSchema —— 大纲白板布局体（纯数据 + 容错解析）
 *
 * 【定位】布局体是白板的「位置与呈现」真相，**不含内容**：组件只持有表现形式类型与配置，
 * 内容一律由 nodeId 指向的 outline_node 派生。结构定义见
 * docs/plans/2026-09-15-大纲芽重构-理论基线与现状.md §8.10.2。
 *
 * 【容错原则】解析永不抛错：非法 JSON / 结构缺失 / 类型不符一律回退到安全默认，
 * 保证「坏数据不炸视图」（用户手改 DB、版本升级、半写入都可能产生坏数据）。
 */
import type { Point, Rect } from './boardGeometry'

export const BOARD_LAYOUT_VERSION = 1

export type SectionArrange = 'free' | 'vertical' | 'horizontal' | 'grid'

/** 区：人工划分，承担「组间约束」 */
export interface BoardSection {
  id: string
  title?: string
  rect: Rect
  arrange: SectionArrange
  order: number
}

/** 容器：与大纲节点 1:1 的摆放单位 */
export interface BoardContainer {
  id: string
  nodeId: string
  sectionId?: string
  pos: Point
  /** 未设置 = 内容自适应尺寸 */
  size?: { w: number; h: number }
  collapsed?: boolean
  components: BoardComponent[]
}

/** 组件：承载某一种表现形式的结构 */
export interface BoardComponent {
  id: string
  /** 表现形式类型（见 board/forms/registry.ts） */
  form: string
  order: number
  config?: Record<string, unknown>
}

export interface OutlineBoardLayout {
  version: number
  sections: BoardSection[]
  containers: BoardContainer[]
}

/** 生成带前缀的 id（与项目既有 `out-${Date.now()}-${rand}` 约定一致） */
export function genBoardId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function createEmptyBoardLayout(): OutlineBoardLayout {
  return { version: BOARD_LAYOUT_VERSION, sections: [], containers: [] }
}

export function createComponent(
  form: string,
  order: number,
  config?: Record<string, unknown>,
): BoardComponent {
  const c: BoardComponent = { id: genBoardId('bc'), form, order }
  if (config) c.config = config
  return c
}

export function createContainer(
  nodeId: string,
  pos: Point,
  opts: { sectionId?: string; size?: { w: number; h: number } } = {},
): BoardContainer {
  const container: BoardContainer = {
    id: genBoardId('bct'),
    nodeId,
    pos: { x: Math.round(pos.x), y: Math.round(pos.y) },
    components: [],
  }
  if (opts.sectionId) container.sectionId = opts.sectionId
  if (opts.size) container.size = opts.size
  return container
}

// ─────────────────────────────────────────────
// 解析与序列化（容错）
// ─────────────────────────────────────────────

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function parseRect(v: unknown): Rect {
  const o = (v ?? {}) as Record<string, unknown>
  return { x: num(o.x, 0), y: num(o.y, 0), w: Math.max(0, num(o.w, 0)), h: Math.max(0, num(o.h, 0)) }
}

function parsePoint(v: unknown): Point {
  const o = (v ?? {}) as Record<string, unknown>
  return { x: num(o.x, 0), y: num(o.y, 0) }
}

function parseArrange(v: unknown): SectionArrange {
  return v === 'vertical' || v === 'horizontal' || v === 'grid' ? v : 'free'
}

function parseComponent(v: unknown): BoardComponent | null {
  const o = (v ?? {}) as Record<string, unknown>
  const form = str(o.form)
  if (!form) return null
  const c: BoardComponent = {
    id: str(o.id) || genBoardId('bc'),
    form,
    order: num(o.order, 0),
  }
  if (o.config && typeof o.config === 'object') c.config = o.config as Record<string, unknown>
  return c
}

function parseContainer(v: unknown): BoardContainer | null {
  const o = (v ?? {}) as Record<string, unknown>
  const nodeId = str(o.nodeId)
  if (!nodeId) return null
  const rawComponents = Array.isArray(o.components) ? o.components : []
  const components = rawComponents
    .map(parseComponent)
    .filter((c): c is BoardComponent => !!c)
    .sort((a, b) => a.order - b.order)
  const container: BoardContainer = {
    id: str(o.id) || genBoardId('bct'),
    nodeId,
    pos: parsePoint(o.pos),
    components,
  }
  const sectionId = str(o.sectionId)
  if (sectionId) container.sectionId = sectionId
  if (o.size && typeof o.size === 'object') {
    const s = o.size as Record<string, unknown>
    container.size = { w: Math.max(0, num(s.w, 0)), h: Math.max(0, num(s.h, 0)) }
  }
  if (o.collapsed === true) container.collapsed = true
  return container
}

function parseSection(v: unknown): BoardSection | null {
  const o = (v ?? {}) as Record<string, unknown>
  const id = str(o.id)
  if (!id) return null
  const section: BoardSection = {
    id,
    rect: parseRect(o.rect),
    arrange: parseArrange(o.arrange),
    order: num(o.order, 0),
  }
  const title = str(o.title)
  if (title) section.title = title
  return section
}

/**
 * 解析布局体：接受 JSON 字符串或对象；任何异常都回退为空布局（不抛错）。
 */
export function parseBoardLayout(raw: unknown): OutlineBoardLayout {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return createEmptyBoardLayout()
    try {
      obj = JSON.parse(text)
    } catch {
      return createEmptyBoardLayout()
    }
  }
  if (!obj || typeof obj !== 'object') return createEmptyBoardLayout()
  const o = obj as Record<string, unknown>
  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map(parseSection)
    .filter((s): s is BoardSection => !!s)
    .sort((a, b) => a.order - b.order)
  const containers = (Array.isArray(o.containers) ? o.containers : [])
    .map(parseContainer)
    .filter((c): c is BoardContainer => !!c)
  return { version: num(o.version, BOARD_LAYOUT_VERSION), sections, containers }
}

export function serializeBoardLayout(layout: OutlineBoardLayout): string {
  return JSON.stringify(layout)
}

// ─────────────────────────────────────────────
// 查询与变更（纯函数；变更返回新对象，便于测试与撤销快照）
// ─────────────────────────────────────────────

export function findContainer(
  layout: OutlineBoardLayout,
  containerId: string,
): BoardContainer | undefined {
  return layout.containers.find(c => c.id === containerId)
}

/** 同板内该节点是否已有容器（判定 §8.10.5-B：一板一节点一容器） */
export function findContainerByNode(
  layout: OutlineBoardLayout,
  nodeId: string,
): BoardContainer | undefined {
  return layout.containers.find(c => c.nodeId === nodeId)
}

export function nextComponentOrder(container: BoardContainer): number {
  return container.components.reduce((max, c) => Math.max(max, c.order), 0) + 1
}

/** 悬空容器：nodeId 已不在实体集合中（节点被删） */
export function danglingContainerIds(
  layout: OutlineBoardLayout,
  existingNodeIds: Set<string>,
): string[] {
  return layout.containers.filter(c => !existingNodeIds.has(c.nodeId)).map(c => c.id)
}

/** 显式清理悬空容器（由用户点击触发，绝不自动执行） */
export function removeContainers(
  layout: OutlineBoardLayout,
  containerIds: string[],
): OutlineBoardLayout {
  const drop = new Set(containerIds)
  return { ...layout, containers: layout.containers.filter(c => !drop.has(c.id)) }
}

/** 全部容器的世界坐标矩形（供吸附、适配全部使用） */
export function containerRects(layout: OutlineBoardLayout, fallback: { w: number; h: number }): Rect[] {
  return layout.containers.map(c => ({
    x: c.pos.x,
    y: c.pos.y,
    w: c.size?.w ?? fallback.w,
    h: c.size?.h ?? fallback.h,
  }))
}

/** 区矩形（含容器时用于「带的容器整体移动」等判断） */
export function sectionRects(layout: OutlineBoardLayout): Rect[] {
  return layout.sections.map(s => s.rect)
}

/** 替换某个容器（不可变更新） */
export function replaceContainer(
  layout: OutlineBoardLayout,
  containerId: string,
  next: BoardContainer,
): OutlineBoardLayout {
  return {
    ...layout,
    containers: layout.containers.map(c => (c.id === containerId ? next : c)),
  }
}

/** 组件重排：按数组顺序重写 order（1 基） */
export function reorderComponents(
  container: BoardContainer,
  orderedIds: string[],
): BoardContainer {
  const byId = new Map(container.components.map(c => [c.id, c]))
  const next: BoardComponent[] = []
  orderedIds.forEach((id, idx) => {
    const c = byId.get(id)
    if (c) next.push({ ...c, order: idx + 1 })
  })
  // 未列入 orderedIds 的组件按原相对顺序追加在后（防御：避免丢组件）
  for (const c of container.components) {
    if (!orderedIds.includes(c.id)) next.push({ ...c, order: next.length + 1 })
  }
  return { ...container, components: next }
}
