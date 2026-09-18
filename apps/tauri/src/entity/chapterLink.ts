/**
 * chapterLink —— 「章节（manuscript）↔ 大纲节点（outline_node）」关联的**唯一写入入口**
 *
 * 【为什么需要这个模块（2026-09-18 取证结论）】
 * 这条关系此前**存储双轨、且无人同步**，造成双向断裂：
 *   · 章节侧写 `manuscript.properties.outlineNodeId`（章节右键「关联大纲节点」；ManuscriptView 的筛选读它）
 *   · 大纲侧写 `outline_node.properties.manuscriptId`（白板属性面板**手填 ID**；白板「打开正文」按钮读它）
 *   · **没有任何代码同步两者** →
 *     ① 章节侧关联了节点 → 白板的「打开正文」不亮；
 *     ② 大纲侧填了章节 ID → 章节侧的筛选看不到。
 *
 * 处置（负责人 09-18 拍板）：**保留两个字段、但把「关联 / 解除」收敛到本模块**，
 * 内部双侧同写 + 按 1:1 语义清理旧值。这样冗余仍存在，但**一致性由代码保证，不再靠纪律维持**。
 *
 * 【与关系表（relations）的关系】
 * 语义上最正确的做法是走关系表，但关系类型注册表目前只有 `appears_in` / `draft_of`
 * 两条且目标都必须是 manuscript，补 `outline_node ↔ manuscript` 属**未拍板**事项
 * （与「关联实体徽章 / `link_entity`」同一前置）。故本模块是**过渡实现**：
 * 将来关系表落地时，把本模块的实现换掉即可，调用方不必改。
 *
 * 【1:1 语义】
 * 一个章节只属于一个大纲节点，反之亦然。故建立新关联时必须**清理两侧的旧关联**，
 * 否则会出现「章节 A 指向节点 N，而 N 指向章节 B」这种不一致。
 */
import type { Entity } from '@worldsea/entity-core'

/** 章节实体类型名（与 manuscript 芽注册的 entityType 一致） */
export const CHAPTER_TYPE = 'manuscript'

/** 字段名（两侧各有一个；本模块是它们唯一的写入方） */
export const LINK_FIELD = {
  /** 章节 → 节点 */
  chapterToNode: 'outlineNodeId',
  /** 节点 → 章节 */
  nodeToChapter: 'manuscriptId',
} as const

/**
 * 本模块对 store 的最小依赖（只用到这两条能力 → 便于测试注入替身）。
 * 注意 `getAllEntities()` **直接委托 storage、不改变 store 状态**——
 * 这正是这里不能用 `es.loadByType('manuscript')` 的原因：后者会把 store 的 `entities`
 * 收窄成该类型、**挤掉其它芽的实体**（框架级陷阱，见施工分解 §十三 A-7）。
 */
export interface ChapterLinkStore {
  getAllEntities(): Promise<Entity[]>
  /** 与实体 store 的更新语义一致：顶层浅合并 + `properties` **整体替换** */
  update(
    id: string,
    patch: { properties: Record<string, unknown>; updatedAt?: string },
  ): Promise<unknown>
}

/** 写操作的结果（供调用方提示文案与测试断言） */
export interface LinkOutcome {
  /** 实际被写入的实体 id（最多两个：章节 + 节点） */
  written: string[]
  /** 因 1:1 语义被解除的**旧**关联 */
  cleared: Array<{ id: string; side: 'chapter' | 'node' }>
}

// ── 纯判定（无副作用，可单测）────────────────────

export function chapterIdOfNode(node: Entity | undefined | null): string {
  return String((node?.properties?.[LINK_FIELD.nodeToChapter] as string) ?? '').trim()
}

export function nodeIdOfChapter(chapter: Entity | undefined | null): string {
  return String((chapter?.properties?.[LINK_FIELD.chapterToNode] as string) ?? '').trim()
}

/**
 * 该章节是否**指向**指定节点（只看章节侧）。
 * 双侧汇总判定请用 `buildChapterLinkIndex`——双轨期间可能存在只有一侧有值的历史数据，
 * 只看一侧会把已关联的显示成未关联（用户会重复关联）。
 */
export function isChapterLinkedToNode(chapter: Entity | undefined, nodeId: string): boolean {
  if (!nodeId) return false
  return nodeIdOfChapter(chapter) === nodeId
}

/** 该节点是否已关联某个章节（判断「打开正文」按钮该不该出现） */
export function hasLinkedChapter(node: Entity | undefined): boolean {
  return chapterIdOfNode(node) !== ''
}

// ── 内部工具 ────────────────────────────────────

/** properties 是**整体替换**语义，故任何写入都必须基于当前 properties 合并 */
function merged(entity: Entity, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(entity.properties ?? {}), ...patch }
}

function findById(all: Entity[], id: string): Entity | undefined {
  return all.find(e => e.id === id)
}

// ── 写操作（唯一入口）──────────────────────────

/**
 * 建立关联（1:1）：清理两侧旧关联 → 双侧写入。
 * **幂等**：已互相关联时不做任何写入（返回空 outcome），避免无谓的 store 变更与渲染。
 */
export async function linkChapterToNode(
  store: ChapterLinkStore,
  chapterId: string,
  nodeId: string,
): Promise<LinkOutcome> {
  const outcome: LinkOutcome = { written: [], cleared: [] }
  if (!chapterId || !nodeId) return outcome

  const all = await store.getAllEntities()
  const chapter = findById(all, chapterId)
  const node = findById(all, nodeId)
  if (!chapter || !node) return outcome

  // 已是目标关联 → 幂等返回
  if (nodeIdOfChapter(chapter) === nodeId && chapterIdOfNode(node) === chapterId) return outcome

  const writes: Array<Promise<unknown>> = []
  const nowIso = new Date().toISOString()
  // 注意：`updatedAt` 是实体**顶层**字段，不属 properties（写进 properties 会污染业务字段）
  const touch = (e: Entity, patch: Record<string, unknown>) =>
    store.update(e.id, { properties: merged(e, patch), updatedAt: nowIso })

  // ① 章节原来属于别的节点 → 清掉那个节点的反向字段
  const prevNodeId = nodeIdOfChapter(chapter)
  if (prevNodeId && prevNodeId !== nodeId) {
    const prevNode = findById(all, prevNodeId)
    if (prevNode) {
      writes.push(touch(prevNode, { [LINK_FIELD.nodeToChapter]: '' }))
      outcome.cleared.push({ id: prevNode.id, side: 'node' })
    }
  }

  // ② 节点原来关联着别的章节 → 清掉那个章节的反向字段
  const prevChapterId = chapterIdOfNode(node)
  if (prevChapterId && prevChapterId !== chapterId) {
    const prevChapter = findById(all, prevChapterId)
    if (prevChapter) {
      writes.push(touch(prevChapter, { [LINK_FIELD.chapterToNode]: '' }))
      outcome.cleared.push({ id: prevChapter.id, side: 'chapter' })
    }
  }

  // ③ 双侧写入新关联
  writes.push(touch(chapter, { [LINK_FIELD.chapterToNode]: nodeId }))
  writes.push(touch(node, { [LINK_FIELD.nodeToChapter]: chapterId }))
  outcome.written.push(chapter.id, node.id)

  await Promise.all(writes)
  return outcome
}

/**
 * 从**章节侧**解除关联：清两侧字段。
 * 章节与节点**都不删除**——解除关联是纯关系操作（与「删书不删章」同一纪律）。
 */
export async function unlinkChapter(store: ChapterLinkStore, chapterId: string): Promise<LinkOutcome> {
  const outcome: LinkOutcome = { written: [], cleared: [] }
  if (!chapterId) return outcome

  const all = await store.getAllEntities()
  const chapter = findById(all, chapterId)
  if (!chapter) return outcome

  const nodeId = nodeIdOfChapter(chapter)
  const nowIso = new Date().toISOString()
  const writes: Array<Promise<unknown>> = []
  const touch = (e: Entity, patch: Record<string, unknown>) =>
    store.update(e.id, { properties: merged(e, patch), updatedAt: nowIso })

  writes.push(touch(chapter, { [LINK_FIELD.chapterToNode]: '' }))
  outcome.written.push(chapter.id)

  if (nodeId) {
    const node = findById(all, nodeId)
    // 仅当该节点的反向字段确实指向本章节时才清（避免误清「节点已改关联别的章节」的情况）
    if (node && chapterIdOfNode(node) === chapterId) {
      writes.push(touch(node, { [LINK_FIELD.nodeToChapter]: '' }))
      outcome.written.push(node.id)
    }
  }

  await Promise.all(writes)
  return outcome
}

/** 从**节点侧**解除关联（白板属性面板的「解除关联」用） */
export async function unlinkNode(store: ChapterLinkStore, nodeId: string): Promise<LinkOutcome> {
  const outcome: LinkOutcome = { written: [], cleared: [] }
  if (!nodeId) return outcome

  const all = await store.getAllEntities()
  const node = findById(all, nodeId)
  if (!node) return outcome

  const chapterId = chapterIdOfNode(node)
  const nowIso = new Date().toISOString()
  const writes: Array<Promise<unknown>> = []
  const touch = (e: Entity, patch: Record<string, unknown>) =>
    store.update(e.id, { properties: merged(e, patch), updatedAt: nowIso })

  writes.push(touch(node, { [LINK_FIELD.nodeToChapter]: '' }))
  outcome.written.push(node.id)

  if (chapterId) {
    const chapter = findById(all, chapterId)
    if (chapter && nodeIdOfChapter(chapter) === nodeId) {
      writes.push(touch(chapter, { [LINK_FIELD.chapterToNode]: '' }))
      outcome.written.push(chapter.id)
    }
  }

  await Promise.all(writes)
  return outcome
}

/**
 * 一次性读取「章节 ↔ 节点」的双向映射（右栏「已关联」标记与反查用）。
 * 只读、不改 store 状态；O(n) 一次扫描。
 *
 * **归一化**：双轨期间可能存在「只有一侧有值」的历史数据，故两遍扫描互相补齐——
 * 消费方拿到的是「只要任一侧声明了该关联，两个方向的 map 都能查到」，
 * 不必自己写回退逻辑（否则每个消费点都要重复一遍，且容易只查一个方向）。
 */
export interface ChapterLinkIndex {
  /** 章节 id → 节点 id */
  nodeByChapter: Map<string, string>
  /** 节点 id → 章节 id */
  chapterByNode: Map<string, string>
}

export function buildChapterLinkIndex(entities: Entity[]): ChapterLinkIndex {
  const nodeByChapter = new Map<string, string>()
  const chapterByNode = new Map<string, string>()

  const record = (chapterId: string, nodeId: string): void => {
    if (!chapterId || !nodeId) return
    if (!nodeByChapter.has(chapterId)) nodeByChapter.set(chapterId, nodeId)
    if (!chapterByNode.has(nodeId)) chapterByNode.set(nodeId, chapterId)
  }

  // 第一遍：章节侧声明的关联
  for (const e of entities) {
    if (e.type === CHAPTER_TYPE) record(e.id, nodeIdOfChapter(e))
  }
  // 第二遍：节点侧声明的关联（补上第一遍缺的那一侧）
  for (const e of entities) {
    if (e.type === 'outline_node') record(chapterIdOfNode(e), e.id)
  }
  return { nodeByChapter, chapterByNode }
}

/** 读章节列表（只读；供右栏「章节」tab 用） */
export async function listChapters(store: ChapterLinkStore): Promise<Entity[]> {
  const all = await store.getAllEntities()
  return all.filter(e => e.type === CHAPTER_TYPE)
}
