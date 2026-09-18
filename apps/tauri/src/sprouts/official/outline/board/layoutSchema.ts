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
import { hitTestRects, shiftRect, type Point, type Rect } from './boardGeometry'

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

/** 分量前先补一个容器自适应尺寸的估算值（吸附/包围盒/命中都要用，故收敛到单一定义） */
export const DEFAULT_CONTAINER_SIZE = { w: 200, h: 80 }

/**
 * 命中测试：世界坐标落在哪个容器内（没有则 null）。
 *
 * **逆序遍历**：`containers` 的数组顺序即 DOM 渲染顺序，**后渲染的在视觉上层**，
 * 故命中应优先返回靠后的那个——否则重叠时会把落点判给被压住的容器。
 * （区与容器是兄弟、容器之间可重叠，故重叠是正常态而非异常。）
 */
export function containerAtPoint(
  containers: BoardContainer[],
  point: { x: number; y: number },
  fallback: { w: number; h: number } = DEFAULT_CONTAINER_SIZE,
): BoardContainer | null {
  for (let i = containers.length - 1; i >= 0; i -= 1) {
    const r = rectOfContainer(containers[i], fallback)
    if (point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h) {
      return containers[i]
    }
  }
  return null
}

/** 取容器的有效矩形：显式尺寸优先，未设尺寸时用估算值（单一实现，避免多处漂移） */
export function rectOfContainer(
  container: BoardContainer,
  fallback: { w: number; h: number } = DEFAULT_CONTAINER_SIZE,
): Rect {
  return {
    x: container.pos.x,
    y: container.pos.y,
    w: container.size?.w ?? fallback.w,
    h: container.size?.h ?? fallback.h,
  }
}

/** 全部容器的世界坐标矩形（供吸附、适配全部使用） */
export function containerRects(layout: OutlineBoardLayout, fallback: { w: number; h: number }): Rect[] {
  return layout.containers.map(c => rectOfContainer(c, fallback))
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

// ─────────────────────────────────────────────
// 区（Section）：人工划分，承担「组间约束」
// 规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §二
// ─────────────────────────────────────────────

export function createSection(
  rect: Rect,
  opts: { title?: string; arrange?: SectionArrange; order?: number } = {},
): BoardSection {
  const section: BoardSection = {
    id: genBoardId('sec'),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.max(0, Math.round(rect.w)),
      h: Math.max(0, Math.round(rect.h)),
    },
    arrange: opts.arrange ?? 'free',
    order: opts.order ?? 1,
  }
  const title = (opts.title ?? '').trim()
  if (title) section.title = title
  return section
}

export function nextSectionOrder(layout: OutlineBoardLayout): number {
  return layout.sections.reduce((max, s) => Math.max(max, s.order), 0) + 1
}

export function findSection(layout: OutlineBoardLayout, sectionId: string): BoardSection | undefined {
  return layout.sections.find(s => s.id === sectionId)
}

export function replaceSection(
  layout: OutlineBoardLayout,
  sectionId: string,
  next: BoardSection,
): OutlineBoardLayout {
  return {
    ...layout,
    sections: layout.sections.map(s => (s.id === sectionId ? next : s)),
  }
}

/** 区内容器（按 sectionId 归属；归属在拖动结束时由几何重算，见 resolveSectionFor） */
export function containersOfSection(
  layout: OutlineBoardLayout,
  sectionId: string,
): BoardContainer[] {
  return layout.containers.filter(c => c.sectionId === sectionId)
}

/**
 * 删区（二选一，规格 §二）：
 * · mode='detach'：**仅删区**，容器落回画布（清 sectionId，位置不变）
 * · mode='cascade'：连区内容器一起删（**只删容器，仍不删节点**）
 */
export function removeSections(
  layout: OutlineBoardLayout,
  sectionIds: string[],
  mode: 'detach' | 'cascade' = 'detach',
): OutlineBoardLayout {
  const drop = new Set(sectionIds)
  const sections = layout.sections.filter(s => !drop.has(s.id))
  const containers = mode === 'cascade'
    ? layout.containers.filter(c => !(c.sectionId && drop.has(c.sectionId)))
    : layout.containers.map(c =>
      c.sectionId && drop.has(c.sectionId) ? stripSectionId(c) : c,
    )
  return { ...layout, sections, containers }
}

/** 清掉容器的 sectionId（不可变） */
export function stripSectionId(container: BoardContainer): BoardContainer {
  const next: BoardContainer = { ...container }
  delete next.sectionId
  return next
}

/** 设置/清除容器归属区（不可变） */
export function setContainerSectionId(
  layout: OutlineBoardLayout,
  containerId: string,
  sectionId: string | null,
): OutlineBoardLayout {
  return {
    ...layout,
    containers: layout.containers.map(c => {
      if (c.id !== containerId) return c
      if (!sectionId) return stripSectionId(c)
      if (c.sectionId === sectionId) return c
      return { ...c, sectionId }
    }),
  }
}

/**
 * 区平移 = **区矩形与其内容器一起平移**（规格 §二「关键语义」，一次原子变更）。
 * 内容器依据 sectionId 归属确定，与容器当前坐标无关——所以先落进区的容器即便
 * 被拖到区外（归属尚未重算）也仍然跟随，语义一致。
 */
export function shiftSectionWithContainers(
  layout: OutlineBoardLayout,
  sectionId: string,
  dx: number,
  dy: number,
): OutlineBoardLayout {
  const section = findSection(layout, sectionId)
  if (!section || (!dx && !dy)) return layout
  return {
    ...layout,
    sections: layout.sections.map(s =>
      s.id === sectionId ? { ...s, rect: shiftRect(s.rect, dx, dy) } : s,
    ),
    containers: layout.containers.map(c =>
      c.sectionId === sectionId ? { ...c, pos: { x: c.pos.x + dx, y: c.pos.y + dy } } : c,
    ),
  }
}

/**
 * 点的区命中：返回**最上层**命中的区（后绘制者在上）。用于容器拖动结束后的归属重算。
 * 未命中任何区 → null（容器脱离区）。
 */
export function sectionAtPoint(layout: OutlineBoardLayout, p: Point): BoardSection | null {
  const idx = hitTestRects(p, sectionRects(layout))
  return idx >= 0 ? layout.sections[idx] : null
}

/**
 * 依据容器矩形中心点解析它应归属的区 id（null = 不归属任何区）。
 * 用中心点而非「完全包含」：容器跨区界时归属由中心决定，避免出现「半个容器在区里」的歧义。
 */
export function resolveSectionFor(
  layout: OutlineBoardLayout,
  containerRect: Rect,
): string | null {
  const center = { x: containerRect.x + containerRect.w / 2, y: containerRect.y + containerRect.h / 2 }
  return sectionAtPoint(layout, center)?.id ?? null
}
