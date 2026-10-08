/**
 * outlineRefs —— 「关联实体徽章」的分组纯函数
 *
 * 【形态来源】旧树视图的「关联实体徽章组」（`useOutlineEntityLinks.ts`，09-17 随旧视图删除）：
 * **按实体类型聚合**（排除 `parent_child`）、**点击跳转实体**。本文是它的等价重建，
 * 但只做**数据分组**（纯函数），渲染交给 `OutlineRefsForm.vue`。
 *
 * 【数据来源】关系表里「源为 outline_node、目标为大纲以外实体」的那几条关系类型
 * （2026-09-18 新增：`outline_mentions` / `outline_located_in` / `outline_covers`）。
 * **具体是哪几条由调用方传入** —— 不在这里写死常量，否则会把「注册表即扩展点」
 * 变成「两处各维护一份类型清单」，新增关系类型时必漏一处。
 */
import type { Relation } from '@worldsea/entity-core'

/** 徽章用的最小实体视图（只取分组与显示需要的字段，便于测试注入） */
export interface RefEntityLike {
  id: string
  type: string
  name?: string
}

export interface OutlineRefMember {
  id: string
  /** 显示名（空则回退「未命名」） */
  name: string
  /** 该成员是通过哪条关系关联上的（用于 title 提示，如「提及」/「发生于」） */
  relationTypes: string[]
}

export interface OutlineRefGroup {
  /** 目标实体类型（如 character / region） */
  entityType: string
  members: OutlineRefMember[]
}

/** 关系两端的另一端 id（本节点相关的另一端） */
function otherEndOf(rel: Relation, nodeId: string): string {
  return rel.sourceId === nodeId ? rel.targetId : rel.sourceId
}

/**
 * 取出与 `nodeId` 相关、且属于 `refRelationTypes` 的关系。
 * **方向不敏感**：关系可能是「节点 → 实体」也可能是「实体 → 节点」（inverse 方向），
 * 徽章关心的是「有关联」而不是「谁指向谁」。
 */
export function refRelationsOf(
  relations: readonly Relation[],
  nodeId: string,
  refRelationTypes: readonly string[],
): Relation[] {
  if (!nodeId) return []
  const allowed = new Set(refRelationTypes)
  return relations.filter(
    r => allowed.has(r.type) && (r.sourceId === nodeId || r.targetId === nodeId),
  )
}

/**
 * 按目标实体类型聚合徽章。
 *
 * 三条规则（都来自旧实现语义）：
 * 1. **按实体类型分组**（同类型合一组，组内按名字排序）——徽章是「概览」不是「清单」
 * 2. **同一实体经多条关系关联时只出现一次**（组内去重，但保留全部关系类型便于提示）
 * 3. **另一端实体不存在时丢弃**（实体被删 → 关系成孤儿；徽章不显示幽灵条目）
 */
export function groupOutlineRefs(
  relations: readonly Relation[],
  nodeId: string,
  entityById: ReadonlyMap<string, RefEntityLike>,
  refRelationTypes: readonly string[],
): OutlineRefGroup[] {
  const hits = refRelationsOf(relations, nodeId, refRelationTypes)
  if (!hits.length) return []

  // entityType → (entityId → member)
  const grouped = new Map<string, Map<string, OutlineRefMember>>()

  for (const rel of hits) {
    const otherId = otherEndOf(rel, nodeId)
    const entity = entityById.get(otherId)
    if (!entity) continue // 孤儿关系：实体已删

    let bucket = grouped.get(entity.type)
    if (!bucket) {
      bucket = new Map()
      grouped.set(entity.type, bucket)
    }
    const existing = bucket.get(entity.id)
    if (existing) {
      if (!existing.relationTypes.includes(rel.type)) existing.relationTypes.push(rel.type)
    } else {
      bucket.set(entity.id, {
        id: entity.id,
        name: (entity.name ?? '').trim() || '未命名',
        relationTypes: [rel.type],
      })
    }
  }

  // 组内按名字排序（localeCompare 中文拼音序，项目既有惯例）
  const out: OutlineRefGroup[] = []
  for (const [entityType, bucket] of grouped) {
    out.push({
      entityType,
      members: [...bucket.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    })
  }
  // 组间按成员数降序（多的更值得一眼看到），同数量按类型名稳定排序
  out.sort((a, b) => b.members.length - a.members.length || a.entityType.localeCompare(b.entityType))
  return out
}

/** 徽章总计（容器头之类的紧凑展示用：「关联 5」） */
export function totalRefCount(groups: readonly OutlineRefGroup[]): number {
  return groups.reduce((s, g) => s + g.members.length, 0)
}

/** 关系 schema 的最小形状（`type`（V2）与 `typeKey`（旧）两种命名都兼容） */
export interface RelationSchemaLike {
  type?: string
  typeKey?: string
  sourceTypes?: string[]
  targetTypes?: string[]
}

/**
 * 从关系注册表筛出「徽章应该纳入」的关系类型。
 *
 * 调用方应传 **`relationshipRegistry.getBySourceType('outline_node')`** 的结果
 * —— 该注册表按 sourceType 索引，且 `defineRelation` **自动注册的 inverse 不会被它返回**
 * （inverse 的 sourceTypes 是原 targetTypes，即各芽实体，不含 outline_node）✓
 *
 * 本函数再做一层防御过滤：**目标全部是 outline 以外实体**的类型才纳入。
 * 于是：
 * · `parent_child`（目标也是 outline_node）→ 排除 ✓
 * · 新增一条「节点 → 某芽实体」的类型 → **自动纳入**，无需改本文件（「注册表即扩展点」）✓
 */
export function pickRefRelationTypes(
  schemas: ReadonlyArray<RelationSchemaLike>,
  nodeType = 'outline_node',
): string[] {
  const out: string[] = []
  for (const r of schemas) {
    const name = r.type ?? r.typeKey ?? ''
    if (!name) continue
    if (!(r.sourceTypes ?? []).includes(nodeType)) continue
    const targets = r.targetTypes ?? []
    // 目标里出现 outline 自身/白板 → 属「大纲内部关系」，不进徽章
    if (!targets.length || targets.some(t => t === nodeType || t.startsWith('outline_'))) continue
    out.push(name)
  }
  return out
}

/**
 * 「目标类型 → 可用关系类型」反查（2026-10-08「关联实体」编辑行）。
 *
 * 排序 = **专一者优先**（targetTypes 数量升序）：更专一的关系类型是更准确的表达，
 * 故首位即该类型的默认选择——建筑同时可「发生于」（2 个目标）与「提及」（12 个目标）时，
 * 默认取「发生于」。这是从注册表推导的启发式，不是硬编码映射：新增类型自动进候选。
 */
export function refRelationTypesForTarget(
  schemas: ReadonlyArray<RelationSchemaLike>,
  targetType: string,
  nodeType = 'outline_node',
): string[] {
  const hits: Array<{ name: string; breadth: number }> = []
  for (const r of schemas) {
    const name = r.type ?? r.typeKey ?? ''
    if (!name) continue
    if (!(r.sourceTypes ?? []).includes(nodeType)) continue
    const targets = r.targetTypes ?? []
    if (!targets.includes(targetType)) continue
    hits.push({ name, breadth: targets.length })
  }
  return hits.sort((a, b) => a.breadth - b.breadth).map(h => h.name)
}

/** 合法目标类型并集（候选实体的类型过滤用；排除 outline 内部目标，与 pickRefRelationTypes 同口径） */
export function refTargetTypes(
  schemas: ReadonlyArray<RelationSchemaLike>,
  nodeType = 'outline_node',
): string[] {
  const out = new Set<string>()
  for (const r of schemas) {
    if (!(r.sourceTypes ?? []).includes(nodeType)) continue
    for (const t of r.targetTypes ?? []) {
      if (t === nodeType || t.startsWith('outline_')) continue
      out.add(t)
    }
  }
  return [...out]
}
