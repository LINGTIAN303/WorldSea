/**
 * 记忆衰减与压缩
 *
 * 增强现有 localStorage 记忆系统的淘汰策略：
 * - 时间衰减因子：越久未访问，权重越低
 * - 自动摘要压缩：旧记忆被压缩为摘要而非直接删除
 * - 软淘汰：标记为 deprecated 而非立即删除
 * - 定期整理：合并相似记忆、清理过时条目
 *
 * 同时适用于 KB 知识库的衰减管理
 */

import { loadMemory, saveMemory, type MemoryEntry } from '../tools/memory-internal'
import { kbList, kbWrite, kbReadById, type KBEntry, type KBScope } from './kb-store'

const DECAY_HALF_LIFE_DAYS = 30
const SOFT_EVICT_THRESHOLD = 0.1
const COMPRESS_AGE_DAYS = 60

function decayFactor(lastAccessedAt: number): number {
  const ageDays = (Date.now() - lastAccessedAt) / 86400000
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS)
}

function memoryScore(entry: MemoryEntry): number {
  const accessWeight = Math.log2(entry.accessCount + 1)
  const decay = decayFactor(entry.lastAccessedAt)
  return accessWeight * decay
}

export interface DecayReport {
  total: number
  healthy: number
  decaying: number
  deprecated: number
  compressed: number
  actions: string[]
}

export function analyzeMemoryDecay(): DecayReport {
  const entries = loadMemory()
  const report: DecayReport = {
    total: entries.length,
    healthy: 0,
    decaying: 0,
    deprecated: 0,
    compressed: 0,
    actions: [],
  }

  for (const e of entries) {
    const score = memoryScore(e)
    const ageDays = (Date.now() - e.timestamp) / 86400000

    if (e.tags.includes('deprecated')) {
      report.deprecated++
    } else if (score < SOFT_EVICT_THRESHOLD) {
      report.decaying++
      report.actions.push(`[衰减] ${e.key} — 评分 ${score.toFixed(3)}，${Math.round(ageDays)}天未访问`)
    } else if (ageDays > COMPRESS_AGE_DAYS && e.value.length > 200) {
      report.compressed++
      report.actions.push(`[可压缩] ${e.key} — ${e.value.length}字，${Math.round(ageDays)}天前创建`)
    } else {
      report.healthy++
    }
  }

  return report
}

export function applyDecayAndCompress(): {
  deprecated: number
  compressed: number
  removed: number
} {
  const entries = loadMemory()
  let deprecated = 0
  let compressed = 0
  let removed = 0

  const updated: MemoryEntry[] = []

  for (const e of entries) {
    const score = memoryScore(e)
    const ageDays = (Date.now() - e.timestamp) / 86400000

    if (e.tags.includes('deprecated') && ageDays > 90) {
      removed++
      continue
    }

    if (score < SOFT_EVICT_THRESHOLD && !e.tags.includes('deprecated')) {
      e.tags = [...e.tags.filter(t => t !== 'deprecated'), 'deprecated']
      deprecated++
    }

    if (ageDays > COMPRESS_AGE_DAYS && e.value.length > 200 && !e.tags.includes('compressed')) {
      e.value = compressValue(e.value)
      e.tags = [...e.tags.filter(t => t !== 'compressed'), 'compressed']
      compressed++
    }

    updated.push(e)
  }

  saveMemory(updated)
  return { deprecated, compressed, removed }
}

function compressValue(value: string): string {
  const lines = value.split('\n').filter(l => l.trim())
  if (lines.length <= 3) return value

  const first = lines[0]
  const last = lines[lines.length - 1]
  const midSummary = lines.slice(1, -1).map(l => l.trim()).join(' ').slice(0, 100)

  return `${first}\n[摘要] ${midSummary}...\n${last}`
}

export interface KBDecayReport {
  total: number
  stale: number
  candidates: Array<{
    id: string
    path: string
    scope: string
    ageDays: number
    accessCount: number
    score: number
  }>
}

export async function analyzeKBDecay(scope?: KBScope): Promise<KBDecayReport> {
  const entries = await kbList(scope)
  const report: KBDecayReport = {
    total: entries.length,
    stale: 0,
    candidates: [],
  }

  for (const e of entries) {
    const ageDays = (Date.now() - e.updatedAt) / 86400000
    const decay = decayFactor(e.lastAccessedAt)
    const score = Math.log2(e.accessCount + 1) * decay

    if (score < SOFT_EVICT_THRESHOLD && ageDays > 30) {
      report.stale++
      report.candidates.push({
        id: e.id,
        path: `${e.scope}/${e.path}`,
        scope: e.scope,
        ageDays: Math.round(ageDays),
        accessCount: e.accessCount,
        score,
      })
    }
  }

  report.candidates.sort((a, b) => a.score - b.score)
  return report
}

export async function compressKBEntries(scope?: KBScope): Promise<number> {
  const entries = await kbList(scope)
  let compressed = 0

  for (const e of entries) {
    const ageDays = (Date.now() - e.updatedAt) / 86400000
    if (ageDays > COMPRESS_AGE_DAYS && e.accessCount < 2) {
      const full = await kbReadById(e.id)
      if (!full || !full.content || full.content.length <= 500) continue
      const compressedContent = compressKBContent(full)
      await kbWrite({
        path: e.path,
        scope: e.scope as KBScope,
        content: compressedContent,
        tags: [...e.tags.filter(t => t !== 'compressed'), 'compressed'],
        entityId: e.entityId,
        summary: e.summary || compressedContent.slice(0, 200),
      })
      compressed++
    }
  }

  return compressed
}

function compressKBContent(entry: KBEntry & { content: string }): string {
  const lines = entry.content.split('\n')
  const headings = lines.filter(l => /^#{1,3}\s/.test(l.trim()))
  const firstParagraph = lines.find(l => l.trim() && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('```'))

  const parts: string[] = []
  if (headings.length > 0) parts.push(headings[0])
  if (firstParagraph) parts.push(firstParagraph)
  parts.push('')
  parts.push('> [压缩] 原文已压缩，详细内容请查看历史版本')
  parts.push(`> 原始大小: ${entry.content.length} 字符`)

  return parts.join('\n')
}
