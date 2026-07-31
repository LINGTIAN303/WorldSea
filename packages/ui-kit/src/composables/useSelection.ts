import { ref, type InjectionKey, type Ref, inject } from 'vue'

export interface SelectionState {
  selectedId: Ref<string | null>
  selectedType: Ref<string | null>
  select(id: string | null, type?: string | null): void
}

export const SelectionKey: InjectionKey<SelectionState> = Symbol('SelectionState')

/**
 * 局部选中（默认）：每个调用方独立。
 * 若需要全局共享（仅 InfoPanel 一处用），在 App.vue 用 provideSelection() 顶层提供。
 */
export function useSelection(): SelectionState {
  const existing = inject(SelectionKey, null)
  if (existing) return existing

  const selectedId = ref<string | null>(null)
  const selectedType = ref<string | null>(null)
  function select(id: string | null, type: string | null = null) {
    selectedId.value = id
    selectedType.value = type
  }
  return { selectedId, selectedType, select }
}

/**
 * 顶层提供全局共享选择（在 App.vue setup 中调用一次）。
 * 返回需通过 provide(SelectionKey, state) 注入。
 */
export function provideGlobalSelection(): SelectionState {
  const selectedId = ref<string | null>(null)
  const selectedType = ref<string | null>(null)
  function select(id: string | null, type: string | null = null) {
    selectedId.value = id
    selectedType.value = type
  }
  return { selectedId, selectedType, select }
}
