import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fieldRegistry, type RegisteredField } from '../core/FieldRegistry'

interface PresetData {
  order: string[]
  customFields: RegisteredField[]
}

export const useFieldOrderStore = defineStore('fieldOrder', () => {
  const STORAGE_KEY = 'worldsea_field_orders'

  const orders = ref<Record<string, { active: string; presets: Record<string, PresetData> }>>({})

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) orders.value = JSON.parse(raw)
    } catch {}
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders.value))
  }

  function getFieldOrder(entityType: string): string[] | null {
    const entry = orders.value[entityType]
    if (!entry || !entry.presets[entry.active]) return null
    const preset = entry.presets[entry.active]
    return preset.order || (Array.isArray(preset) ? preset : null)
  }

  function setFieldOrder(entityType: string, fieldKeys: string[]) {
    if (!orders.value[entityType]) {
      orders.value[entityType] = { active: '默认', presets: { '默认': { order: fieldKeys, customFields: [] } } }
    } else {
      orders.value[entityType].presets[orders.value[entityType].active] = { order: fieldKeys, customFields: [] }
    }
    save()
  }

  function savePreset(entityType: string, presetName: string, fieldKeys: string[]) {
    if (!orders.value[entityType]) {
      orders.value[entityType] = { active: '默认', presets: {} }
    }
    const customFields = fieldRegistry.getFields(entityType).filter(f => f.source !== 'builtin')
    orders.value[entityType].presets[presetName] = { order: fieldKeys, customFields }
    save()
  }

  function loadPreset(entityType: string, presetName: string) {
    if (!orders.value[entityType]) return
    const preset = orders.value[entityType].presets[presetName]
    if (preset) {
      orders.value[entityType].active = presetName
      fieldRegistry.resetToBuiltin(entityType)
      for (const f of preset.customFields || []) {
        fieldRegistry.addUserField(entityType, f)
      }
      const order = preset.order || (Array.isArray(preset) ? preset : [])
      if (order.length > 0) {
        fieldRegistry.setOrder(entityType, order)
      }
      save()
    }
  }

  function deletePreset(entityType: string, presetName: string) {
    if (!orders.value[entityType]) return
    delete orders.value[entityType].presets[presetName]
    if (orders.value[entityType].active === presetName) {
      orders.value[entityType].active = Object.keys(orders.value[entityType].presets)[0] || '默认'
    }
    save()
  }

  function getPresetNames(entityType: string): string[] {
    return orders.value[entityType] ? Object.keys(orders.value[entityType].presets) : []
  }

  function getActivePreset(entityType: string): string {
    return orders.value[entityType]?.active || '默认'
  }

  function getPresetOrder(entityType: string, presetName: string): string[] | null {
    const preset = orders.value[entityType]?.presets[presetName]
    if (!preset) return null
    return preset.order ?? null
  }

  function getPresetData(entityType: string, presetName: string): PresetData | null {
    return orders.value[entityType]?.presets[presetName] ?? null
  }

  function resetToDefault(entityType: string) {
    if (!orders.value[entityType]) {
      delete orders.value[entityType]
      fieldRegistry.resetToBuiltin(entityType)
      save()
      return
    }
    const defaultOrder = orders.value[entityType].presets['默认']
    if (defaultOrder) {
      orders.value[entityType].active = '默认'
      fieldRegistry.setOrder(entityType, defaultOrder.order || [])
    } else {
      delete orders.value[entityType]
      fieldRegistry.resetToBuiltin(entityType)
    }
    const userPresets = Object.keys(orders.value[entityType]?.presets || {}).filter(n => n !== '默认')
    for (const n of userPresets) {
      delete orders.value[entityType]?.presets[n]
    }
    save()
  }

  function resetAll() {
    fieldRegistry.resetToBuiltin()
    orders.value = {}
    save()
  }

  load()

  return { orders, getFieldOrder, setFieldOrder, savePreset, loadPreset, deletePreset, getPresetNames, getActivePreset, getPresetOrder, getPresetData, resetToDefault, resetAll }
})
