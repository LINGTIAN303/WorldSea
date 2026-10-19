/**
 * 潜在链接索引（Passive Index）——自 AutoLinkEngine 减压抽出（2026-10-07）。
 * 纯内存存储，无外部依赖；引擎 re-export 保原导出面。
 */

import type { SemanticHintName } from '../types/trait'
import { recordAutoLinkEvent } from './AutoLinkRuntime'

/** 潜在链接条目 */
export interface PotentialLink {
  id: string
  /** 源实体 ID */
  sourceEntityId: string
  /** 源字段 key */
  sourceFieldKey: string
  /** 源字段中的文本值 */
  sourceText: string
  /** 匹配到的目标实体 ID */
  targetEntityId: string
  /** 匹配到的目标实体类型 */
  targetEntityType: string
  /** 匹配到的目标字段值 */
  targetFieldValue: string
  /** 语义标签 */
  hint: SemanticHintName
  /** 建议的关系类型 */
  relationType: string
  /** 建议方向：source=本实体为关系源；target=本实体为关系目标（创建时反向） */
  direction: 'source' | 'target'
  /** 置信度：exact 或 fuzzy */
  confidence: 'exact' | 'fuzzy'
  /** 匹配分数（0-1） */
  score: number
  /** 用户是否已处理 */
  resolved: boolean
  /** 用户决定：confirmed / dismissed */
  decision?: 'confirmed' | 'dismissed'
  /** 创建时间 */
  createdAt: string
}

/** 潜在链接索引存储 */
export class PotentialLinkIndexClass {
  private links = new Map<string, PotentialLink>()
  /** 按源实体索引 */
  private bySource = new Map<string, PotentialLink[]>()

  add(link: PotentialLink): void {
    this.links.set(link.id, link)
    const list = this.bySource.get(link.sourceEntityId) || []
    list.push(link)
    this.bySource.set(link.sourceEntityId, list)
    recordAutoLinkEvent('link:add', `${link.sourceFieldKey} → ${link.targetEntityType}`, {
      linkId: link.id,
      sourceEntityId: link.sourceEntityId,
      targetEntityId: link.targetEntityId,
      hint: link.hint,
      relationType: link.relationType,
      score: link.score,
    })
  }

  getBySource(entityId: string): PotentialLink[] {
    return (this.bySource.get(entityId) || []).filter(l => !l.resolved)
  }

  /** 该源实体的全部条目（含已 resolved；决策应用与测试使用） */
  getAllBySource(entityId: string): PotentialLink[] {
    return this.bySource.get(entityId) || []
  }

  get(id: string): PotentialLink | undefined {
    return this.links.get(id)
  }

  resolve(id: string, decision: 'confirmed' | 'dismissed'): void {
    const link = this.links.get(id)
    if (!link) return
    link.resolved = true
    link.decision = decision
    recordAutoLinkEvent('link:resolve', `${link.sourceFieldKey} → ${link.targetEntityType} · ${decision}`, {
      linkId: id,
      decision,
    })
  }

  getAll(): PotentialLink[] {
    return Array.from(this.links.values())
  }

  /** 清除指定实体的所有未解决链接（实体删除时调用） */
  clearBySource(entityId: string): void {
    const links = this.bySource.get(entityId)
    if (links) {
      for (const link of links) {
        this.links.delete(link.id)
      }
      this.bySource.delete(entityId)
    }
  }
}

export const potentialLinkIndex = new PotentialLinkIndexClass()
