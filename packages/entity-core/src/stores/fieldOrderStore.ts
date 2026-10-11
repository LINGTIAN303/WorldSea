import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fieldRegistry, type RegisteredField } from '../core/FieldRegistry'

interface PresetData {
  order: string[]
  /**
   * 旧结构里的字段定义快照。**已不再写入也不再消费**（保留键名只为读旧 localStorage 不炸）：
   * 应用预设时据此补字段会「复活」用户后来主动删掉的字段，不补又会静默丢字段——
   * 两头都是意外。字段本身是**类型级真值**（`fieldRegistry`），预设只决定顺序。
   */
  customFields?: RegisteredField[]
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
      orders.value[entityType] = { active: '默认', presets: { '默认': { order: fieldKeys } } }
    } else {
      orders.value[entityType].presets[orders.value[entityType].active] = { order: fieldKeys }
    }
    save()
  }

  function savePreset(entityType: string, presetName: string, fieldKeys: string[]) {
    if (!orders.value[entityType]) {
      orders.value[entityType] = { active: '默认', presets: {} }
    }
    orders.value[entityType].presets[presetName] = { order: fieldKeys }
    save()
  }

  /**
   * 应用预设＝**只重排，不增删字段**（2026-10-03 裁定「分轴」的落地口径）。
   *
   * 原实现先 `fieldRegistry.resetToBuiltin(entityType)` 再只放回预设里存的字段快照，
   * 于是「存过预设之后新增的自定义字段」会在点一下「使用」时凭空消失；
   * 而 registry 的字段集与顺序正是详情面可用字段的来源，弹窗里这个动作会连带改掉详情的结构。
   * 反过来「按快照补字段」也不成立：用户后来主动删掉的字段会被复活。
   * 两头都是意外，所以把轴分干净：**字段是类型级真值（`fieldRegistry`），预设只是一份命名的顺序档**；
   * 预设引用到已不存在的 key 就跳过，registry 里预设没见过的新字段补在末尾而不是被吞。
   */
  function loadPreset(entityType: string, presetName: string) {
    if (!orders.value[entityType]) return
    const preset = orders.value[entityType].presets[presetName]
    if (!preset) return
    orders.value[entityType].active = presetName
    applyBaseOrder(entityType, preset.order || (Array.isArray(preset) ? preset : []))
    save()
  }

  /** 把预设的基准序写进 registry，预设里不存在的现有字段补在末尾（不静默消失） */
  function applyBaseOrder(entityType: string, order: string[]) {
    if (!order.length) return
    const live = fieldRegistry.getFields(entityType).map(f => f.key)
    fieldRegistry.setOrder(entityType, [...order.filter(k => live.includes(k)), ...live.filter(k => !order.includes(k))])
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
      applyBaseOrder(entityType, defaultOrder.order || [])
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
