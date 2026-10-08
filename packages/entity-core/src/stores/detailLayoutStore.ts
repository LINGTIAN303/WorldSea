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

/** 详情 Tab 的用户覆写（按实体类型，2026-10-08 Tab 优化批）：排序与隐藏（info/relations 由消费侧钉底） */
export interface DetailTabOverride {
  order?: string[]
  hidden?: string[]
}

export const useDetailLayoutStore = defineStore('detailLayout', () => {
  const STORAGE_KEY = 'worldsea_detail_layouts'
  /** L1 载体形态按实体类型记，与 L2 布局覆写**分键**：换容器与换编排是两件事，
   *  同键存放会让「恢复芽默认」连载体一起清掉（那是两个决定）。 */
  const CARRIER_KEY = 'worldsea_detail_carriers'
  /** 新建自定义字段的默认作用域。放本 store 而非 settingsStore——后者已在 arch 冻结线上方，
   *  再加键会让门禁点「增长」；而它本身就是详情面的偏好。 */
  const FIELD_SCOPE_KEY = 'worldsea_custom_field_scope'
  /** 抽屉遮罩行为：缺省＝穿透（开着抽屉还能直接点列表），可切「拦截并点击关闭」 */
  const BACKDROP_KEY = 'worldsea_detail_backdrop'
  /** Tab 排序/隐藏覆写（2026-10-08 Tab 优化批）：与 carriers/backdrop 同构，按实体类型、只存用户明确改过的 */
  const TAB_KEY = 'worldsea_detail_tabs'

  const overrides = ref<Record<string, DetailLayoutOverride>>({})
  /** 实体类型 → 载体 id（未设＝用缺省抽屉） */
  const carriers = ref<Record<string, string>>({})
  /** 实体类型 → Tab 覆写（未设＝芽声明默认序） */
  const tabOverrides = ref<Record<string, DetailTabOverride>>({})
  const fieldScopeDefault = ref<'entity' | 'type'>(
    localStorage.getItem(FIELD_SCOPE_KEY) === 'type' ? 'type' : 'entity',
  )

  /** 抽屉遮罩行为，**全局一条**（不是按实体类型）：`passthrough`＝开着抽屉仍能直接点列表（缺省，
   *  与批次 2 之前的观感一致）；`blocking`＝遮罩拦住点击、点空白关抽屉。 */
  const backdropMode = ref<'passthrough' | 'blocking'>(
    localStorage.getItem(BACKDROP_KEY) === 'blocking' ? 'blocking' : 'passthrough',
  )

  /** 按类型的遮罩覆写（只存"用户明确选过的"，未存的类型走全局默认）。
   *  与载体覆写同构：两层各有各的键，清掉覆写＝回到全局，不该顺手把全局也改了。 */
  const BACKDROP_TYPE_KEY = 'worldsea_detail_backdrop_types'
  const backdropOverrides = ref<Record<string, 'passthrough' | 'blocking'>>({})

  watch(fieldScopeDefault, v => localStorage.setItem(FIELD_SCOPE_KEY, v))
  watch(backdropMode, v => localStorage.setItem(BACKDROP_KEY, v))

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) overrides.value = JSON.parse(raw)
      const carrierRaw = localStorage.getItem(CARRIER_KEY)
      if (carrierRaw) carriers.value = JSON.parse(carrierRaw)
      const backdropRaw = localStorage.getItem(BACKDROP_TYPE_KEY)
      if (backdropRaw) backdropOverrides.value = JSON.parse(backdropRaw)
      const tabRaw = localStorage.getItem(TAB_KEY)
      if (tabRaw) tabOverrides.value = JSON.parse(tabRaw)
    } catch {
      overrides.value = {}
      carriers.value = {}
      backdropOverrides.value = {}
      tabOverrides.value = {}
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

  /** 遮罩档位的**唯一解析口**：类型覆写 > 全局默认。读的一方不许自己拼 `??`，否则又是两条真值路径 */
  function backdropFor(entityType: string): 'passthrough' | 'blocking' {
    return backdropOverrides.value[entityType] ?? backdropMode.value
  }

  function setBackdropOverride(entityType: string, mode: 'passthrough' | 'blocking') {
    backdropOverrides.value = { ...backdropOverrides.value, [entityType]: mode }
    localStorage.setItem(BACKDROP_TYPE_KEY, JSON.stringify(backdropOverrides.value))
  }

  function clearBackdropOverride(entityType: string) {
    const next = { ...backdropOverrides.value }
    delete next[entityType]
    backdropOverrides.value = next
    localStorage.setItem(BACKDROP_TYPE_KEY, JSON.stringify(next))
  }

  function setTabOverride(entityType: string, override: DetailTabOverride) {
    tabOverrides.value = { ...tabOverrides.value, [entityType]: override }
    localStorage.setItem(TAB_KEY, JSON.stringify(tabOverrides.value))
  }

  function clearTabOverride(entityType: string) {
    const next = { ...tabOverrides.value }
    delete next[entityType]
    tabOverrides.value = next
    localStorage.setItem(TAB_KEY, JSON.stringify(next))
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

  return {
    overrides, carriers, fieldScopeDefault, backdropMode, backdropOverrides, tabOverrides,
    get, patch, clear, setCarrier, clearCarrier,
    backdropFor, setBackdropOverride, clearBackdropOverride,
    setTabOverride, clearTabOverride,
  }
})
