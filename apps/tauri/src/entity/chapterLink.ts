/**
 * chapterLink —— 「正文章节（manuscript）↔ 大纲节点（outline_node）」关联的**唯一写入入口**。
 *
 * R6-a（2026-10-20）：关系唯一真源。旧实现的双侧字符串字段（manuscript.outlineNodeId /
 * outline_node.manuscriptId）已移除；旧存储值仅由 migrateLegacyChapterLinks 读取并迁移。
 * 关系方向：outline_node --outline_chapter--> manuscript；反向 chapter_outline。
 * 1:1 语义：一个章节只对应一个节点，反之亦然。
 */
import type { Entity, Relation } from '@worldsea/entity-core'

export const CHAPTER_TYPE = 'manuscript'
export const NODE_TYPE = 'outline_node'
export const CHAPTER_LINK_REL = 'outline_chapter'
export const CHAPTER_LINK_INVERSE = 'chapter_outline'

/** 旧字段仅用于迁移与迁移前兜底读取；新代码不写。 */
export const LEGACY_LINK_FIELD = {
  chapterToNode: 'outlineNodeId',
  nodeToChapter: 'manuscriptId',
} as const

export interface ChapterLinkStore {
  getAllEntities(): Promise<Entity[]>
}

export interface ChapterRelationStore {
  relations: readonly Relation[]
  add(
    relation: Relation,
    source?: 'user' | 'agent' | 'import',
    opts?: { skipUndo?: boolean },
  ): Promise<unknown>
  remove(
    id: string,
    source?: 'user' | 'agent' | 'import',
    opts?: { skipUndo?: boolean },
  ): Promise<unknown>
}

export interface LinkOutcome {
  written: string[]
  cleared: Array<{ id: string; side: 'chapter' | 'node' }>
}

export interface ChapterLinkIndex {
  nodeByChapter: Map<string, string>
  chapterByNode: Map<string, string>
}

let relationSeq = 0
function newRelationId(prefix: string): string {
  relationSeq += 1
  return `${prefix}-${Date.now()}-${relationSeq}-${Math.random().toString(36).slice(2, 6)}`
}

function legacyNodeIdOfChapter(chapter: Entity | null | undefined): string {
  return String((chapter?.properties?.[LEGACY_LINK_FIELD.chapterToNode] as string) ?? '').trim()
}

function legacyChapterIdOfNode(node: Entity | null | undefined): string {
  return String((node?.properties?.[LEGACY_LINK_FIELD.nodeToChapter] as string) ?? '').trim()
}

/** 旧字段读取（迁移源/兜底；UI 不应新增调用）。 */
export function nodeIdOfChapter(chapter: Entity | null | undefined): string {
  return legacyNodeIdOfChapter(chapter)
}

export function chapterIdOfNode(node: Entity | null | undefined): string {
  return legacyChapterIdOfNode(node)
}

function forwards(relations: readonly Relation[]): Relation[] {
  return relations.filter(r => r.type === CHAPTER_LINK_REL)
}

function buildPair(nodeId: string, chapterId: string): [Relation, Relation] {
  const now = new Date().toISOString()
  const pairId = newRelationId('pair')
  return [
    {
      id: newRelationId('rel'),
      type: CHAPTER_LINK_REL,
      sourceId: nodeId,
      targetId: chapterId,
      properties: {},
      pairId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: newRelationId('rel'),
      type: CHAPTER_LINK_INVERSE,
      sourceId: chapterId,
      targetId: nodeId,
      properties: {},
      pairId,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

async function removePair(relations: ChapterRelationStore, relation: Relation): Promise<void> {
  const ids = relation.pairId
    ? relations.relations.filter(r => r.pairId === relation.pairId).map(r => r.id)
    : [relation.id]
  for (const id of ids) await relations.remove(id)
}

export async function linkChapterToNode(
  store: ChapterLinkStore,
  relations: ChapterRelationStore,
  chapterId: string,
  nodeId: string,
): Promise<LinkOutcome> {
  const outcome: LinkOutcome = { written: [], cleared: [] }
  if (!chapterId || !nodeId) return outcome

  const all = await store.getAllEntities()
  const chapter = all.find(e => e.id === chapterId && e.type === CHAPTER_TYPE)
  const node = all.find(e => e.id === nodeId && e.type === NODE_TYPE)
  if (!chapter || !node) return outcome

  const currentForChapter = forwards(relations.relations).find(r => r.targetId === chapterId)
  const currentForNode = forwards(relations.relations).find(r => r.sourceId === nodeId)
  if (currentForChapter?.sourceId === nodeId && currentForNode?.targetId === chapterId) return outcome

  const removing = new Map<string, Relation>()
  const cleared = new Map<string, { id: string; side: 'chapter' | 'node' }>()
  for (const relation of forwards(relations.relations)) {
    if (relation.targetId === chapterId) {
      removing.set(relation.id, relation)
      cleared.set(`node:${relation.sourceId}`, { id: relation.sourceId, side: 'node' })
    }
    if (relation.sourceId === nodeId) {
      removing.set(relation.id, relation)
      cleared.set(`chapter:${relation.targetId}`, { id: relation.targetId, side: 'chapter' })
    }
  }
  for (const relation of removing.values()) await removePair(relations, relation)
  outcome.cleared = [...cleared.values()]

  const [forward, inverse] = buildPair(nodeId, chapterId)
  await relations.add(forward)
  await relations.add(inverse)
  outcome.written.push(chapterId, nodeId)
  return outcome
}

export async function unlinkChapter(
  _store: ChapterLinkStore,
  relations: ChapterRelationStore,
  chapterId: string,
): Promise<LinkOutcome> {
  const outcome: LinkOutcome = { written: [], cleared: [] }
  if (!chapterId) return outcome
  const relation = forwards(relations.relations).find(r => r.targetId === chapterId)
  if (!relation) return outcome
  await removePair(relations, relation)
  outcome.written.push(chapterId, relation.sourceId)
  return outcome
}

export async function unlinkNode(
  _store: ChapterLinkStore,
  relations: ChapterRelationStore,
  nodeId: string,
): Promise<LinkOutcome> {
  const outcome: LinkOutcome = { written: [], cleared: [] }
  if (!nodeId) return outcome
  const relation = forwards(relations.relations).find(r => r.sourceId === nodeId)
  if (!relation) return outcome
  await removePair(relations, relation)
  outcome.written.push(nodeId, relation.targetId)
  return outcome
}

export function buildChapterLinkIndex(
  entities: readonly Entity[],
  relations: readonly Relation[],
): ChapterLinkIndex {
  const nodeByChapter = new Map<string, string>()
  const chapterByNode = new Map<string, string>()
  for (const relation of forwards(relations)) {
    if (!nodeByChapter.has(relation.targetId)) nodeByChapter.set(relation.targetId, relation.sourceId)
    if (!chapterByNode.has(relation.sourceId)) chapterByNode.set(relation.sourceId, relation.targetId)
  }
  // 旧字段兜底：迁移前/迁移失败时仍能显示既有绑定；关系永远优先
  for (const entity of entities) {
    if (entity.type === CHAPTER_TYPE) {
      const nodeId = legacyNodeIdOfChapter(entity)
      if (nodeId && !nodeByChapter.has(entity.id)) {
        nodeByChapter.set(entity.id, nodeId)
        if (!chapterByNode.has(nodeId)) chapterByNode.set(nodeId, entity.id)
      }
    }
    if (entity.type === NODE_TYPE) {
      const chapterId = legacyChapterIdOfNode(entity)
      if (chapterId && !chapterByNode.has(entity.id)) {
        chapterByNode.set(entity.id, chapterId)
        if (!nodeByChapter.has(chapterId)) nodeByChapter.set(chapterId, entity.id)
      }
    }
  }
  return { nodeByChapter, chapterByNode }
}

/** 旧字段 → 关系的一次性幂等迁移；不修改实体、不进撤销栈。 */
export async function migrateLegacyChapterLinks(
  store: ChapterLinkStore,
  relations: ChapterRelationStore,
): Promise<number> {
  const all = await store.getAllEntities()
  const nodes = new Map(all.filter(e => e.type === NODE_TYPE).map(e => [e.id, e]))
  const chapters = new Map(all.filter(e => e.type === CHAPTER_TYPE).map(e => [e.id, e]))
  const existing = forwards(relations.relations)
  const usedNodes = new Set(existing.map(r => r.sourceId))
  const usedChapters = new Set(existing.map(r => r.targetId))
  const pairs = new Map<string, string>()

  for (const chapter of chapters.values()) {
    const nodeId = legacyNodeIdOfChapter(chapter)
    if (nodeId && nodes.has(nodeId)) pairs.set(nodeId, chapter.id)
  }
  for (const node of nodes.values()) {
    const chapterId = legacyChapterIdOfNode(node)
    if (chapterId && chapters.has(chapterId) && !pairs.has(node.id)) {
      pairs.set(node.id, chapterId)
    }
  }

  let created = 0
  for (const [nodeId, chapterId] of pairs) {
    if (usedNodes.has(nodeId) || usedChapters.has(chapterId)) continue
    const [forward, inverse] = buildPair(nodeId, chapterId)
    await relations.add(forward, 'import', { skipUndo: true })
    await relations.add(inverse, 'import', { skipUndo: true })
    usedNodes.add(nodeId)
    usedChapters.add(chapterId)
    created += 1
  }
  return created
}
