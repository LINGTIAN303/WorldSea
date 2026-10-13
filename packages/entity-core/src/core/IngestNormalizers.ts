/**
 * IngestNormalizers — 实体装载边界归一器注册表（2026-10-11）。在**装载边界**（entityStore 的 loadAll/loadByType/loadByPage/getById）
 * 提供 per-type 归一钩子：实体进内存 store 前按类型变换一次，此后所有消费方只见归一后的形态。
 * 设计约束（幂等 / 无变化返回原引用 / 归一器由芽插件注册）详见 docs/details/注释/packages/entity-core/core/IngestNormalizers.md。
 */

import type { Entity } from '../types/entity'

/** 归一器：接收实体，返回归一后的实体（无变化时应返回原引用） */
export type EntityIngestNormalizer = (entity: Entity) => Entity

const normalizers = new Map<string, EntityIngestNormalizer>()

/** 注册某实体类型的装载归一器（同名重复注册以最后一次为准） */
export function registerIngestNormalizer(type: string, fn: EntityIngestNormalizer): void {
  normalizers.set(type, fn)
}

export function unregisterIngestNormalizer(type: string): void {
  normalizers.delete(type)
}

/** 对单个实体应用其类型注册的归一器（未注册类型原样返回） */
export function normalizeIngestEntity<T extends Entity>(entity: T): T {
  const fn = normalizers.get(entity.type)
  if (!fn) return entity
  return fn(entity) as T
}

/** 对实体数组应用归一（过滤语义由调用方自行保留，本函数不丢实体） */
export function normalizeIngestEntities<T extends Entity>(entities: readonly T[]): T[] {
  return entities.map(normalizeIngestEntity)
}
