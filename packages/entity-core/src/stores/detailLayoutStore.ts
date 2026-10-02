import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 详情布局的用户覆写（按实体类型）。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 *
 * 与 `fieldOrderStore`（`worldsea_field_orders`，服务弹窗的字段预设）**分键存放**：
 * 那份的语义是「一类型多套预设命名」，这份是「详情长什么样」，混用会互相搅动。
 */
export interface DetailLayoutOverride {
  order?: string[]
  hidden?: string[]
  groups?: { key: string; label: string; fieldKeys: string[] }[]
  contentForm?: string
}

export const useDetailLayoutStore = defineStore('detailLayout', () => {
  const STORAGE_KEY = 'worldsea_detail_layouts'

  const overrides = ref<Record<string, DetailLayoutOverride>>({})

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) overrides.value = JSON.parse(raw)
    } catch {
      overrides.value = {}
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides.value))
  }

  function get(entityType: string): DetailLayoutOverride | undefined {
    return overrides.value[entityType]
  }

  /** 局部覆写：只合并传入的项，未传的保持原状 */
  function patch(entityType: string, next: DetailLayoutOverride) {
    overrides.value[entityType] = { ...overrides.value[entityType], ...next }
    save()
  }

  function clear(entityType: string) {
    delete overrides.value[entityType]
    save()
  }

  load()

  return { overrides, get, patch, clear }
})
