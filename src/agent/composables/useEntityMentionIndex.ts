/**
 * useEntityMentionIndex — 实体名反向索引
 *
 * 职责：
 * - 从 entityStore 构建实体名 → entityId[] 的反向索引
 * - entityStore 变更时自动更新（computed 驱动）
 * - 提供 matchInText(text) 方法，返回文本中所有实体名匹配位置
 *
 * 设计说明：
 * - name 长度 ≥ 2 才入索引（避免单字歧义）
 * - 同名实体可能多个，匹配时返回全部 entityId
 * - 索引按 name 长度降序排列，优先匹配长名（避免"剑圣"被"剑"截断）
 * - 模块级单例：全局共享同一份索引
 */
import { computed } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'

export interface MentionMatch {
  /** 匹配的实体名 */
  name: string
  /** 在文本中的起始位置 */
  start: number
  /** 在文本中的结束位置 */
  end: number
  /** 匹配到的实体 ID 列表（同名可能多个） */
  entityIds: string[]
  /** 第一个匹配实体的类型（用于图标展示，若多个同名取第一个） */
  entityType: string
}

/** 最小名称长度，避免单字歧义 */
const MIN_NAME_LENGTH = 2

// ===== 模块级单例状态（懒加载，避免模块加载时 Pinia 未初始化） =====
let _entityStore: ReturnType<typeof useEntityStore> | null = null
let _mentionIndex: ReturnType<typeof computed<Map<string, string[]>>> | null = null
let _sortedNames: ReturnType<typeof computed<string[]>> | null = null
let _entityTypeMap: ReturnType<typeof computed<Map<string, string>>> | null = null

function getStore() {
  if (!_entityStore) _entityStore = useEntityStore()
  return _entityStore
}

function getMentionIndex() {
  if (!_mentionIndex) {
    _mentionIndex = computed<Map<string, string[]>>(() => {
      const store = getStore()
      const map = new Map<string, string[]>()
      for (const entity of store.entities) {
        const name = entity.name?.trim()
        if (!name || name.length < MIN_NAME_LENGTH) continue
        const existing = map.get(name)
        if (existing) {
          existing.push(entity.id)
        } else {
          map.set(name, [entity.id])
        }
      }
      return map
    })
  }
  return _mentionIndex
}

function getSortedNames() {
  if (!_sortedNames) {
    _sortedNames = computed<string[]>(() => {
      const names = Array.from(getMentionIndex().value.keys())
      names.sort((a, b) => b.length - a.length)
      return names
    })
  }
  return _sortedNames
}

function getEntityTypeMap() {
  if (!_entityTypeMap) {
    _entityTypeMap = computed<Map<string, string>>(() => {
      const store = getStore()
      const map = new Map<string, string>()
      for (const entity of store.entities) {
        map.set(entity.id, entity.type)
      }
      return map
    })
  }
  return _entityTypeMap
}

/**
 * 在文本中匹配所有实体名，返回不重叠的匹配结果
 * 使用最长匹配优先策略（sortedNames 已按长度降序）
 */
function matchInText(text: string): MentionMatch[] {
  const sortedNames = getSortedNames()
  const mentionIndex = getMentionIndex()
  const entityTypeMap = getEntityTypeMap()
  if (!sortedNames || !mentionIndex || !entityTypeMap) return []
  const sorted = sortedNames.value
  const idxMap = mentionIndex.value
  const typeMap = entityTypeMap.value
  if (!text || !sorted || !idxMap || !typeMap || sorted.length === 0) return []

  const matches: MentionMatch[] = []
  /** 已匹配的字符位置区间（避免重叠） */
  const occupied: Array<[number, number]> = []

  for (const name of sorted) {
    if (name.length < MIN_NAME_LENGTH) continue
    let searchStart = 0
    while (searchStart <= text.length - name.length) {
      const idx = text.indexOf(name, searchStart)
      if (idx === -1) break

      // 检查是否与已匹配区间重叠
      const end = idx + name.length
      const overlaps = occupied.some(([s, e]) => idx < e && end > s)
      if (!overlaps) {
        const entityIds = idxMap.get(name) || []
        matches.push({
          name,
          start: idx,
          end,
          entityIds,
          entityType: typeMap.get(entityIds[0]) || '',
        })
        occupied.push([idx, end])
      }
      searchStart = idx + 1
    }
  }

  // 按起始位置排序
  matches.sort((a, b) => a.start - b.start)
  return matches
}

export function useEntityMentionIndex() {
  return {
    mentionIndex: getMentionIndex(),
    sortedNames: getSortedNames(),
    matchInText,
  }
}
