import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Entity } from '../types/entity'

export interface Template {
  id: string
  name: string
  description: string
  entityType: string
  defaultName: string
  defaultDescription: string
  defaultTags: string[]
  defaultProperties: Record<string, unknown>
  createdAt: string
}

const STORAGE_KEY = 'worldsea-templates'

function loadFromStorage(): Template[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(templates: Template[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

export const useTemplateStore = defineStore('templates', () => {
  const templates = ref<Template[]>(loadFromStorage())

  const byType = computed(() => {
    const map: Record<string, Template[]> = {}
    for (const t of templates.value) {
      if (!map[t.entityType]) map[t.entityType] = []
      map[t.entityType].push(t)
    }
    return map
  })

  function getForType(type: string): Template[] {
    return templates.value.filter(t => t.entityType === type)
  }

  function saveFromEntity(entity: Entity, name: string) {
    if (templates.value.find(t => t.name === name && t.entityType === entity.type)) {
      if (!confirm(`模板 "${name}" 已存在，覆盖？`)) return false
      const idx = templates.value.findIndex(t => t.name === name && t.entityType === entity.type)
      templates.value.splice(idx, 1)
    }
    const tmpl: Template = {
      id: `tmpl-${Date.now()}`,
      name,
      description: `来自「${entity.name}」的 ${entity.type} 模板`,
      entityType: entity.type,
      defaultName: '',
      defaultDescription: entity.description,
      defaultTags: [...(entity.tags || [])],
      defaultProperties: { ...entity.properties },
      createdAt: new Date().toISOString(),
    }
    templates.value.push(tmpl)
    saveToStorage(templates.value)
    return true
  }

  function add(tmpl: Template) {
    templates.value.push(tmpl)
    saveToStorage(templates.value)
  }

  function remove(id: string) {
    templates.value = templates.value.filter(t => t.id !== id)
    saveToStorage(templates.value)
  }

  function clear() {
    templates.value = []
    saveToStorage(templates.value)
  }

  return { templates, byType, getForType, saveFromEntity, add, remove, clear }
})
