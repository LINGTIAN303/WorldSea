import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

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
  /** 当前形态的配置项（表格式无键；段落式/摘要式/时间轴式各有几个开关） */
  contentConfig?: Record<string, unknown>
}

export const useDetailLayoutStore = defineStore('detailLayout', () => {
  const STORAGE_KEY = 'worldsea_detail_layouts'
  /** L1 载体形态按实体类型记，与 L2 布局覆写**分键**：换容器与换编排是两件事，
   *  同键存放会让「恢复芽默认」连载体一起清掉（那是两个决定）。 */
  const CARRIER_KEY = 'worldsea_detail_carriers'
  /** 新建自定义字段的默认作用域。放本 store 而非 settingsStore——后者已在 arch 冻结线上方，
   *  再加键会让门禁点「增长」；而它本身就是详情面的偏好。 */
  const FIELD_SCOPE_KEY = 'worldsea_custom_field_scope'

  const overrides = ref<Record<string, DetailLayoutOverride>>({})
  /** 实体类型 → 载体 id（未设＝用缺省抽屉） */
  const carriers = ref<Record<string, string>>({})
  const fieldScopeDefault = ref<'entity' | 'type'>(
    localStorage.getItem(FIELD_SCOPE_KEY) === 'type' ? 'type' : 'entity',
  )

  watch(fieldScopeDefault, v => localStorage.setItem(FIELD_SCOPE_KEY, v))

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) overrides.value = JSON.parse(raw)
      const carrierRaw = localStorage.getItem(CARRIER_KEY)
      if (carrierRaw) carriers.value = JSON.parse(carrierRaw)
    } catch {
      overrides.value = {}
      carriers.value = {}
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides.value))
  }

  function setCarrier(entityType: string, carrier: string) {
    carriers.value = { ...carriers.value, [entityType]: carrier }
    localStorage.setItem(CARRIER_KEY, JSON.stringify(carriers.value))
  }

  function clearCarrier(entityType: string) {
    const next = { ...carriers.value }
    delete next[entityType]
    carriers.value = next
    localStorage.setItem(CARRIER_KEY, JSON.stringify(next))
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

  return { overrides, carriers, fieldScopeDefault, get, patch, clear, setCarrier, clearCarrier }
})
