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

// ─────────────────────────────────────────────
// 节点 ↔ 节点 横向关系（2026-10-18 Q3-A 裁定）
// ─────────────────────────────────────────────

/**
 * 三条横向关系的全名。与上面三条「节点 → 其它芽实体」是**两组独立类型**：
 * 这里的对端也是 `outline_node`，语义是结构关系（并列 / 递进 / 对比），
 * 不是「提及 / 发生于 / 承载」。注册定义见 `packages/entity-core/src/relations/index.ts`。
 */
export const OUTLINE_LATERAL_RELATION = {
  parallel: 'outline_parallel',
  progressive: 'outline_progressive',
  contrast: 'outline_contrast',
} as const

export type OutlineLateralKey = keyof typeof OUTLINE_LATERAL_RELATION

/** 全名 → 简写（工具与回执里用简写更短） */
export function lateralRelationKeyOf(type: string): OutlineLateralKey | null {
  const hit = (Object.entries(OUTLINE_LATERAL_RELATION) as Array<[OutlineLateralKey, string]>)
    .find(([, full]) => full === type)
  return hit ? hit[0] : null
}

/** 对称关系（并列 / 对比）：方向不敏感，关系表只存一条 */
function isSymmetricLateral(type: string): boolean {
  return type === OUTLINE_LATERAL_RELATION.parallel || type === OUTLINE_LATERAL_RELATION.contrast
}

/** 取与某节点相关的横向关系（方向不敏感：对称关系可能反向存储） */
export function lateralRelationsOf(
  relations: readonly Relation[],
  nodeId: string,
  types: readonly string[] = Object.values(OUTLINE_LATERAL_RELATION),
): Relation[] {
  if (!nodeId) return []
  const allowed = new Set(types)
  return relations.filter(
    r => allowed.has(r.type) && (r.sourceId === nodeId || r.targetId === nodeId),
  )
}

/** 幂等判据：对称关系看双向，递进看单向 */
export function hasOutlineLateral(
  relations: readonly Relation[],
  nodeId: string,
  otherNodeId: string,
  relationType: string,
): boolean {
  const fwd = (r: Relation) => r.type === relationType && r.sourceId === nodeId && r.targetId === otherNodeId
  const rev = (r: Relation) => r.type === relationType && r.sourceId === otherNodeId && r.targetId === nodeId
  return isSymmetricLateral(relationType)
    ? relations.some(r => fwd(r) || rev(r))
    : relations.some(fwd)
}

/**
 * 建立横向关系（幂等）。**方向约定**：
 * - 并列 / 对比（对称）：存 `nodeId → otherNodeId`，读取方双向匹配；
 * - 递进（有向）：`nodeId → otherNodeId` 表示「nodeId 递进到 otherNodeId」，
 *   反向语义由注册表的 inverse（承接）表达，**不落库**（与跨芽关联同口径）。
 *
 * 自连（nodeId === otherNodeId）与非横向类型一律拒绝，不静默回退。
 */
export async function linkOutlineLateral(
  store: OutlineLinkStore,
  nodeId: string,
  otherNodeId: string,
  relationType: string,
): Promise<LinkOutcome> {
  if (!nodeId || !otherNodeId || nodeId === otherNodeId) return 'missing-entity'
  if (!(Object.values(OUTLINE_LATERAL_RELATION) as string[]).includes(relationType)) return 'unknown-relation'
  const relations = await store.getAllRelations()
  if (hasOutlineLateral(relations, nodeId, otherNodeId, relationType)) return 'exists'

  const now = new Date().toISOString()
  await store.add({
    id: `rel-oln-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: relationType,
    sourceId: nodeId,
    targetId: otherNodeId,
    properties: {},
    createdAt: now,
    updatedAt: now,
  } as Relation)
  return 'created'
}

/** 解除横向关系（幂等：不存在返回 false）。对称关系双向查找，递进只删正向 */
export async function unlinkOutlineLateral(
  store: OutlineLinkStore,
  nodeId: string,
  otherNodeId: string,
  relationType: string,
): Promise<boolean> {
  const relations = await store.getAllRelations()
  const hit = relations.find(r => {
    if (r.type !== relationType) return false
    const fwd = r.sourceId === nodeId && r.targetId === otherNodeId
    const rev = r.sourceId === otherNodeId && r.targetId === nodeId
    return isSymmetricLateral(relationType) ? fwd || rev : fwd
  })
  if (!hit) return false
  await store.remove(hit.id)
  return true
}
