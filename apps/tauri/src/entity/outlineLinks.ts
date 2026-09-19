/**
 * outlineLinks —— 「大纲节点 ↔ 芽实体」关联的唯一写入入口
 *
 * 【背景】旧树视图的「关联实体徽章」需要一个数据来源，而大纲节点与
 * 角色/地点/物品等实体之间的**关系类型此前根本不存在**（注册表里只有 `appears_in` /
 * `draft_of` 两条、目标都必须是 manuscript）—— 这正是 `link_entity` 工具被撤下的原因
 * （施工分解 §十四-#5 / §十三 A-9）。2026-09-18 补了三条语义化关系类型：
 *
 * | 简写（Agent 用） | 关系类型 | 语义 | 目标 |
 * | --- | --- | --- | --- |
 * | `mentions` | `outline_mentions` | 提及 | 角色/道具/概念/组织/物种/语言/技能/建筑/文化/植物/战力/素材 |
 * | `located_in` | `outline_located_in` | 发生于 | 区域 / 建筑 |
 * | `covers` | `outline_covers` | 承载 | 事件 / 冲突 |
 *
 * 本模块是该关联的**唯一写入入口**（徽章只读、不写）——与 `chapterLink` 同一纪律：
 * 幂等、经只读接口查重（`getAllRelations()` 不改 store 状态）、**不静默回退**。
 */
import type { Relation } from '@worldsea/entity-core'

/** 简写 → 关系类型全名（Agent 侧用简写，关系表用全名） */
export const OUTLINE_REF_RELATION = {
  mentions: 'outline_mentions',
  located_in: 'outline_located_in',
  covers: 'outline_covers',
} as const

export type OutlineRefRelationKey = keyof typeof OUTLINE_REF_RELATION

/** 本模块对 store 的最小依赖（便于测试注入替身） */
export interface OutlineLinkStore {
  getAllRelations(): Promise<Relation[]>
  add(relation: Relation): Promise<string>
  remove(id: string): Promise<void>
}

export type LinkOutcome = 'created' | 'exists' | 'unknown-relation' | 'missing-entity'

/**
 * 解析简写 → 关系类型全名。
 * **未知值返回 null 而不是回退默认值** —— 回退会让 Agent 写错关系语义却「成功」，
 * 正是本轮要消灭的那类假成功。
 */
export function resolveRefRelation(raw: unknown): string | null {
  const key = String(raw ?? '').trim()
  if (!key) return OUTLINE_REF_RELATION.mentions // 未指定 → 默认「提及」（最泛的一条）
  if (key in OUTLINE_REF_RELATION) return OUTLINE_REF_RELATION[key as OutlineRefRelationKey]
  // 也接受直接传全名（幂等友好）
  const fullNames = Object.values(OUTLINE_REF_RELATION) as string[]
  return fullNames.includes(key) ? key : null
}

/** 全名 → 简写（工具回执里给 Agent 看，用简写更短） */
export function refRelationKeyOf(type: string): OutlineRefRelationKey | null {
  const hit = (Object.entries(OUTLINE_REF_RELATION) as Array<[OutlineRefRelationKey, string]>)
    .find(([, full]) => full === type)
  return hit ? hit[0] : null
}

/** 该节点与该实体之间是否已有此关系（幂等判据：type + source + target 三者相同） */
export function hasOutlineRef(
  relations: readonly Relation[],
  nodeId: string,
  entityId: string,
  relationType: string,
): boolean {
  return relations.some(
    r => r.type === relationType && r.sourceId === nodeId && r.targetId === entityId,
  )
}

/**
 * 建立「节点 → 实体」关联。**幂等**：已存在则返回 `exists`（不重复写）。
 *
 * 方向固定为 **节点 → 实体**（source = 节点）。反向关系由注册表的 inverse 表达，
 * 但**不落库**（关系表只存一条，读取方按方向不敏感匹配 —— 见 `refRelationsOf`）。
 */
export async function linkOutlineEntity(
  store: OutlineLinkStore,
  nodeId: string,
  entityId: string,
  relationType: string,
): Promise<LinkOutcome> {
  if (!nodeId || !entityId) return 'missing-entity'
  const relations = await store.getAllRelations()
  if (hasOutlineRef(relations, nodeId, entityId, relationType)) return 'exists'

  const now = new Date().toISOString()
  await store.add({
    id: `rel-orl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: relationType,
    sourceId: nodeId,
    targetId: entityId,
    properties: {},
    createdAt: now,
    updatedAt: now,
  } as Relation)
  return 'created'
}

/** 解除关联（幂等：不存在则返回 false）。只删这一条，不影响同实体的其它关系类型 */
export async function unlinkOutlineEntity(
  store: OutlineLinkStore,
  nodeId: string,
  entityId: string,
  relationType: string,
): Promise<boolean> {
  const relations = await store.getAllRelations()
  const hit = relations.find(
    r => r.type === relationType && r.sourceId === nodeId && r.targetId === entityId,
  )
  if (!hit) return false
  await store.remove(hit.id)
  return true
}
