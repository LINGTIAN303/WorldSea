import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useDetailLayoutStore, type DetailLayoutOverride } from '@worldsea/entity-core'
import { DEFAULT_CONTENT_FORM, resolveLayout, type DetailLayout, type LayoutSource } from './detailLayout'

/**
 * 详情布局接线：三级来源合并 + 用户覆写落盘。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */
export function useDetailLayout(
  entityType: MaybeRefOrGetter<string>,
  available: MaybeRefOrGetter<string[]>,
  sproutDefault?: MaybeRefOrGetter<LayoutSource | undefined>,
) {
  const store = useDetailLayoutStore()
  /** 即时态：本次浏览内的临时调整，不落盘 */
  const liveState = ref<DetailLayoutOverride>({})

  const type = () => toValue(entityType)

  const layout = computed<DetailLayout>(() => resolveLayout(
    toValue(available),
    toValue(sproutDefault),
    store.get(type()),
    liveState.value,
  ))

  /** 正文实际渲染的字段（已剔除隐藏项） */
  const visibleFieldKeys = computed(() => layout.value.order.filter(k => !layout.value.hidden.includes(k)))

  function setOrder(keys: string[]) {
    store.patch(type(), { order: keys })
  }

  function setHidden(keys: string[]) {
    store.patch(type(), { hidden: keys })
  }

  function toggleHidden(key: string) {
    const current = layout.value.hidden
    store.patch(type(), { hidden: current.includes(key) ? current.filter(k => k !== key) : [...current, key] })
  }

  function setGroups(groups: DetailLayout['groups']) {
    store.patch(type(), { groups })
  }

  function setContentForm(form: string) {
    store.patch(type(), { contentForm: form })
  }

  /** 恢复到芽声明的默认布局 */
  function reset() {
    liveState.value = {}
    store.clear(type())
  }

  return {
    layout,
    visibleFieldKeys,
    liveState,
    setOrder,
    setHidden,
    toggleHidden,
    setGroups,
    setContentForm,
    reset,
    defaultContentForm: DEFAULT_CONTENT_FORM,
  }
}
