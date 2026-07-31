/**
 * 实体-记忆图谱打通
 *
 * 将知识库条目与实体系统联动：
 * - 当记忆/知识涉及某个实体时，自动建立关联
 * - 查询实体时，联动检索相关知识
 * - 实体删除时，清理关联的知识索引
 *
 * 集成到 entity-crud 工具的 after-hook 中
 */

import { kbGetByEntity, kbWrite, kbSearchKeyword, kbLinkEntity, type KBScope } from './kb-store'
import { indexKBEntry } from './kb-indexer'
import type { EntityLike } from '../tools/types'

export interface EntityMemoryLink {
  entityId: string
  entityName: string
  entityType: string
  kbEntries: Array<{
    id: string
    path: string
    summary?: string
    tags: string[]
  }>
}

export async function getEntityMemories(entityId: string, entityName?: string): Promise<EntityMemoryLink | null> {
  const entries = await kbGetByEntity(entityId)
  if (entries.length === 0) return null

  return {
    entityId,
    entityName: entityName || entityId,
    entityType: '',
    kbEntries: entries.map(e => ({
      id: e.id,
      path: e.path,
      summary: e.summary,
      tags: e.tags,
    })),
  }
}

export async function autoLinkEntityKnowledge(entity: EntityLike): Promise<void> {
  const results = await kbSearchKeyword(entity.name, 'project', 5)

  for (const entry of results) {
    if (entry.entityId) continue
    if (isEntityRelevant(entity, entry.summary || entry.path)) {
      await kbLinkEntity(entry.scope, entry.path, entity.id)
    }
  }
}

function isEntityRelevant(entity: EntityLike, text: string): boolean {
  const lower = text.toLowerCase()
  if (lower.includes(entity.name.toLowerCase())) return true
  if (entity.tags?.some(t => lower.includes(t.toLowerCase()))) return true
  if (entity.type && lower.includes(entity.type.toLowerCase())) return true
  return false
}

export async function createEntityKnowledgeSnapshot(entity: EntityLike): Promise<void> {
  const parts: string[] = []

  parts.push(`# ${entity.name}`)
  parts.push('')
  parts.push(`> 类型: ${entity.type}`)
  if (entity.description) {
    parts.push('')
    parts.push('## 描述')
    parts.push(entity.description)
  }
  if (entity.tags?.length) {
    parts.push('')
    parts.push('## 标签')
    parts.push(entity.tags.map(t => `\`${t}\``).join(' '))
  }
  if (entity.properties && Object.keys(entity.properties).length > 0) {
    parts.push('')
    parts.push('## 属性')
    for (const [k, v] of Object.entries(entity.properties)) {
      if (v != null && v !== '') {
        parts.push(`- **${k}**: ${v}`)
      }
    }
  }

  const content = parts.join('\n')
  const safeName = entity.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const path = `entities/${entity.type}/${safeName}.md`
  const summary = entity.description ? entity.description.slice(0, 200) : `${entity.type}: ${entity.name}`

  const entry = await kbWrite({
    path,
    scope: 'project' as KBScope,
    content,
    tags: [entity.type, 'entity-snapshot', ...entity.tags],
    entityId: entity.id,
    summary,
  })

  indexKBEntry(entry).catch(() => {})
}

export function formatEntityMemoriesForPrompt(link: EntityMemoryLink): string {
  if (!link.kbEntries.length) return ''
  const lines = link.kbEntries.map(e => {
    const summary = e.summary ? ` — ${e.summary.slice(0, 80)}` : ''
    return `  - ${e.path}${summary}`
  })
  return `[实体知识: ${link.entityName}]\n${lines.join('\n')}`
}
