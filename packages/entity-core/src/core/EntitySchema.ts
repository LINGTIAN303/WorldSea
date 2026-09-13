import type { EntityTypeSchema } from '../types'

const FALLBACK_TYPE_LABELS: Record<string, string> = {
  character: '角色',
  organization: '势力',
  region: '区域',
  location: '地点',
  item: '道具',
  event: '事件',
  concept: '概念',
  race: '种族',
  species: '物种',
  timeline: '时间线',
  magic: '魔法/技能',
  outline_node: '纲目',
  manuscript: '正文',
  language: '语言',
  culture: '文化',
  conflict: '冲突',
  plant: '植物',
  combat_stat: '战力',
  weapon: '武器',
  inspiration: '素材',
  building: '建筑',
  custom: '自定义',
  apparel: '服饰/装备',
}

const TYPE_EMOJI: Record<string, string> = {
  character: '👤',
  organization: '⚔️',
  region: '🏛',
  location: '📍',
  item: '📦',
  event: '📅',
  concept: '🧠',
  race: '🧬',
  species: '🧬',
  timeline: '📅',
  magic: '✨',
  outline_node: '📋',
  manuscript: '📜',
  language: '🗣️',
  culture: '🎭',
  conflict: '💥',
  plant: '🌿',
  combat_stat: '⚔️',
  weapon: '🗡️',
  inspiration: '💡',
  building: '🏗️',
  custom: '📄',
  apparel: '👘',
}

const TYPE_ICON: Record<string, string> = {
  character: 'character',
  organization: 'war',
  region: 'region',
  location: 'location',
  item: 'item',
  event: 'event',
  concept: 'concept',
  race: 'species',
  species: 'species',
  timeline: 'timeline',
  magic: 'magic',
  outline_node: 'outline',
  manuscript: 'manuscript',
  language: 'language',
  culture: 'culture',
  conflict: 'combat',
  plant: 'plant',
  combat_stat: 'target',
  weapon: 'weapon',
  inspiration: 'inspiration',
  building: 'building',
  custom: 'manuscript',
  apparel: 'apparel',
}

class EntitySchemaRegistry {
  private schemas = new Map<string, EntityTypeSchema>()

  register(schema: EntityTypeSchema): void {
    this.schemas.set(schema.typeKey, schema)
  }

  get(type: string): EntityTypeSchema | undefined {
    return this.schemas.get(type)
  }

  getAll(): EntityTypeSchema[] {
    return Array.from(this.schemas.values())
  }

  getLabel(type: string): string {
    const schema = this.schemas.get(type)
    if (schema?.label) return schema.label
    return FALLBACK_TYPE_LABELS[type] || type
  }

  getEmoji(type: string): string {
    return TYPE_EMOJI[type] || '📄'
  }

  getIconName(type: string): string {
    return TYPE_ICON[type] || 'manuscript'
  }

  unregister(type: string): void {
    this.schemas.delete(type)
  }

  /** 清空所有已注册的 schema（项目切换时使用） */
  clear(): void {
    this.schemas.clear()
  }
}

export const entitySchemaRegistry = new EntitySchemaRegistry()
