/**
 * AutoLink 决策 store（2026-10-07）——「忽略 / 已确认」的跨会话记忆。
 * 键 = 源实体:源字段:目标实体:关系类型；值含「源值+目标值」内容指纹：
 * 两端文本未变 → 决策持续生效（重建索引/重启都不复活）；任一变化 → 决策失效自清、重新评估。
 */

import type { PotentialLink } from './PotentialLinkIndex'
import { recordAutoLinkEvent } from './AutoLinkRuntime'

const DECISIONS_KEY = 'worldsea_potential_link_decisions'

export type AutoLinkDecisionValue = 'confirmed' | 'dismissed'

export interface AutoLinkDecision {
  sourceEntityId: string
  sourceFieldKey: string
  targetEntityId: string
  relationType: string
  decision: AutoLinkDecisionValue
  /** 内容指纹（源值+目标值）；任一端变化 → 决策失效 */
  fingerprint: string
  decidedAt: string
}

export function linkDecisionKey(
  sourceEntityId: string,
  sourceFieldKey: string,
  targetEntityId: string,
  relationType: string,
): string {
  return `${sourceEntityId}:${sourceFieldKey}:${targetEntityId}:${relationType}`
}

/** djb2 指纹（避免把长文本原样塞进 localStorage） */
export function linkFingerprint(sourceText: string, targetValue: string): string {
  const input = `${sourceText}\u0000${targetValue}`
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }
  return h.toString(16)
}

type DecidableLink = Pick<
  PotentialLink,
  'sourceEntityId' | 'sourceFieldKey' | 'targetEntityId' | 'relationType' | 'sourceText' | 'targetFieldValue'
>

export class AutoLinkDecisionStoreClass {
  private map = new Map<string, AutoLinkDecision>()

  constructor() {
    this.load()
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(DECISIONS_KEY)
      if (!raw) return
      const arr: AutoLinkDecision[] = JSON.parse(raw)
      for (const d of arr) {
        this.map.set(linkDecisionKey(d.sourceEntityId, d.sourceFieldKey, d.targetEntityId, d.relationType), d)
      }
    } catch {
      // 损坏数据静默忽略
    }
  }

  private save(): void {
    localStorage.setItem(DECISIONS_KEY, JSON.stringify(Array.from(this.map.values())))
  }

  record(link: DecidableLink, decision: AutoLinkDecisionValue): void {
    const entry: AutoLinkDecision = {
      sourceEntityId: link.sourceEntityId,
      sourceFieldKey: link.sourceFieldKey,
      targetEntityId: link.targetEntityId,
      relationType: link.relationType,
      decision,
      fingerprint: linkFingerprint(link.sourceText, link.targetFieldValue),
      decidedAt: new Date().toISOString(),
    }
    this.map.set(linkDecisionKey(entry.sourceEntityId, entry.sourceFieldKey, entry.targetEntityId, entry.relationType), entry)
    this.save()
    recordAutoLinkEvent('decision:record', `${link.sourceFieldKey} → ${link.targetEntityId} · ${decision}`, {
      sourceEntityId: link.sourceEntityId,
      sourceFieldKey: link.sourceFieldKey,
      targetEntityId: link.targetEntityId,
      relationType: link.relationType,
      decision,
    })
  }

  /** 只读快照（运行时观测面板使用） */
  getAll(): AutoLinkDecision[] {
    return Array.from(this.map.values())
  }

  /** 命中且指纹一致 → 返回决策；指纹不一致 → 失效自清并返回 undefined */
  recall(link: DecidableLink): AutoLinkDecisionValue | undefined {
    const key = linkDecisionKey(link.sourceEntityId, link.sourceFieldKey, link.targetEntityId, link.relationType)
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (entry.fingerprint !== linkFingerprint(link.sourceText, link.targetFieldValue)) {
      this.map.delete(key)
      this.save()
      return undefined
    }
    return entry.decision
  }

  /** 实体删除时清理其相关决策（作为源或作为目标） */
  clearForEntity(entityId: string): void {
    let changed = false
    for (const [key, entry] of this.map) {
      if (entry.sourceEntityId === entityId || entry.targetEntityId === entityId) {
        this.map.delete(key)
        changed = true
      }
    }
    if (changed) this.save()
  }

  clear(): void {
    this.map.clear()
    localStorage.removeItem(DECISIONS_KEY)
  }
}

export const autoLinkDecisionStore = new AutoLinkDecisionStoreClass()
