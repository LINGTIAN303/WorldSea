import { ref } from 'vue'
import { useEntityStore } from '../stores/entityStore'
import { useRelationStore } from '../stores/relationStore'
import type { EntityTemplate, WorldTemplate } from '../types/template'
import type { Entity } from '../types/entity'
import type { Relation } from '../types/relation'

const ENTITY_TEMPLATES_KEY = 'ws_custom_entity_templates'
const WORLD_TEMPLATES_KEY = 'ws_custom_world_templates'

/* ── 内置实体模板 ── */
const builtinEntityTemplates: EntityTemplate[] = [
  // 角色
  { id: 'builtin-char-hero', name: '英雄', icon: 'sword', entityType: 'character', defaultProperties: { role: '英雄', motivation: '', background: '' }, defaultTags: ['主角', '英雄'], source: 'builtin' },
  { id: 'builtin-char-mentor', name: '导师', icon: 'book', entityType: 'character', defaultProperties: { role: '导师', wisdom: '', teachingStyle: '' }, defaultTags: ['导师', '引导者'], source: 'builtin' },
  { id: 'builtin-char-villain', name: '反派', icon: 'flame', entityType: 'character', defaultProperties: { role: '反派', goal: '', weakness: '' }, defaultTags: ['反派', '敌人'], source: 'builtin' },
  { id: 'builtin-char-sidekick', name: '伙伴', icon: 'heart', entityType: 'character', defaultProperties: { role: '伙伴', loyalty: '', skill: '' }, defaultTags: ['伙伴', '盟友'], source: 'builtin' },
  // 地区
  { id: 'builtin-region-kingdom', name: '王国', icon: 'crown', entityType: 'region', defaultProperties: { terrain: '平原', government: '君主制', population: '' }, defaultTags: ['王国', '文明'], source: 'builtin' },
  { id: 'builtin-region-city', name: '城市', icon: 'building', entityType: 'region', defaultProperties: { terrain: '城市', atmosphere: '', landmarks: '' }, defaultTags: ['城市', '聚落'], source: 'builtin' },
  { id: 'builtin-region-wilderness', name: '荒野', icon: 'tree', entityType: 'region', defaultProperties: { terrain: '荒野', danger: '', resources: '' }, defaultTags: ['荒野', '自然'], source: 'builtin' },
  // 组织
  { id: 'builtin-org-guild', name: '公会', icon: 'shield', entityType: 'organization', defaultProperties: { purpose: '公会', structure: '', reputation: '' }, defaultTags: ['公会', '组织'], source: 'builtin' },
  { id: 'builtin-org-cult', name: '教团', icon: 'eye', entityType: 'organization', defaultProperties: { purpose: '教团', belief: '', secrecy: '' }, defaultTags: ['教团', '秘密'], source: 'builtin' },
]

/* ── 内置世界观模板 ── */
const builtinWorldTemplates: WorldTemplate[] = [
  {
    id: 'builtin-world-medieval-kingdom',
    name: '中世纪王国',
    description: '一个经典的中世纪奇幻王国，包含英雄、导师、反派、王国、城市和公会。',
    icon: 'castle',
    entityTemplates: [
      { template: builtinEntityTemplates.find(t => t.id === 'builtin-char-hero')!, count: 1 },
      { template: builtinEntityTemplates.find(t => t.id === 'builtin-char-mentor')!, count: 1 },
      { template: builtinEntityTemplates.find(t => t.id === 'builtin-char-villain')!, count: 1 },
      { template: builtinEntityTemplates.find(t => t.id === 'builtin-char-sidekick')!, count: 1 },
      { template: builtinEntityTemplates.find(t => t.id === 'builtin-region-kingdom')!, count: 1 },
      { template: builtinEntityTemplates.find(t => t.id === 'builtin-region-city')!, count: 1 },
      { template: builtinEntityTemplates.find(t => t.id === 'builtin-org-guild')!, count: 1 },
    ],
    relationTemplates: [
      { sourceIndex: 0, targetIndex: 4, relationType: 'resides_in' },
      { sourceIndex: 1, targetIndex: 4, relationType: 'resides_in' },
      { sourceIndex: 2, targetIndex: 5, relationType: 'resides_in' },
      { sourceIndex: 3, targetIndex: 0, relationType: 'accompanies' },
      { sourceIndex: 6, targetIndex: 4, relationType: 'located_in' },
    ],
    source: 'builtin',
  },
]

function loadFromStorage<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data))
}

export function useEntityTemplates() {
  const customEntityTemplates = ref<EntityTemplate[]>(loadFromStorage<EntityTemplate>(ENTITY_TEMPLATES_KEY))
  const customWorldTemplates = ref<WorldTemplate[]>(loadFromStorage<WorldTemplate>(WORLD_TEMPLATES_KEY))

  function getTemplatesForType(entityType: string): EntityTemplate[] {
    const builtin = builtinEntityTemplates.filter(t => t.entityType === entityType)
    const custom = customEntityTemplates.value.filter(t => t.entityType === entityType)
    return [...builtin, ...custom]
  }

  function getWorldTemplates(): WorldTemplate[] {
    return [...builtinWorldTemplates, ...customWorldTemplates.value]
  }

  async function createFromTemplate(template: EntityTemplate, nameOverride?: string): Promise<string> {
    const entityStore = useEntityStore()
    const now = new Date().toISOString()
    const entity: Entity = {
      id: `${template.entityType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: template.entityType,
      name: nameOverride || template.name,
      description: '',
      properties: { ...template.defaultProperties },
      tags: [...(template.defaultTags || [])],
      createdAt: now,
      updatedAt: now,
    }
    return entityStore.add(entity)
  }

  async function createFromWorldTemplate(worldTemplate: WorldTemplate): Promise<string[]> {
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()
    const createdIds: string[] = []

    // 创建所有实体
    for (const entry of worldTemplate.entityTemplates) {
      for (let i = 0; i < entry.count; i++) {
        const suffix = entry.count > 1 ? ` ${i + 1}` : ''
        const now = new Date().toISOString()
        const entity: Entity = {
          id: `${entry.template.entityType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: entry.template.entityType,
          name: `${entry.template.name}${suffix}`,
          description: '',
          properties: { ...entry.template.defaultProperties },
          tags: [...(entry.template.defaultTags || [])],
          createdAt: now,
          updatedAt: now,
        }
        const id = await entityStore.add(entity)
        createdIds.push(id)
      }
    }

    // 创建关系
    for (const rel of worldTemplate.relationTemplates) {
      if (rel.sourceIndex < createdIds.length && rel.targetIndex < createdIds.length) {
        const now = new Date().toISOString()
        const relation: Relation = {
          id: `rel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: rel.relationType,
          sourceId: createdIds[rel.sourceIndex],
          targetId: createdIds[rel.targetIndex],
          properties: {},
          createdAt: now,
          updatedAt: now,
        }
        await relationStore.add(relation)
      }
    }

    return createdIds
  }

  function addCustomTemplate(template: EntityTemplate) {
    const t = { ...template, source: 'custom' as const }
    customEntityTemplates.value.push(t)
    saveToStorage(ENTITY_TEMPLATES_KEY, customEntityTemplates.value)
  }

  function removeCustomTemplate(id: string) {
    customEntityTemplates.value = customEntityTemplates.value.filter(t => t.id !== id)
    saveToStorage(ENTITY_TEMPLATES_KEY, customEntityTemplates.value)
  }

  function addCustomWorldTemplate(template: WorldTemplate) {
    const t = { ...template, source: 'custom' as const }
    customWorldTemplates.value.push(t)
    saveToStorage(WORLD_TEMPLATES_KEY, customWorldTemplates.value)
  }

  function removeCustomWorldTemplate(id: string) {
    customWorldTemplates.value = customWorldTemplates.value.filter(t => t.id !== id)
    saveToStorage(WORLD_TEMPLATES_KEY, customWorldTemplates.value)
  }

  return {
    getTemplatesForType,
    getWorldTemplates,
    createFromTemplate,
    createFromWorldTemplate,
    addCustomTemplate,
    removeCustomTemplate,
    addCustomWorldTemplate,
    removeCustomWorldTemplate,
  }
}
