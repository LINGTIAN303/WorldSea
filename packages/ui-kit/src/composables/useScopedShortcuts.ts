import { watch, onBeforeUnmount, type Ref } from 'vue'
import { useShortcuts, type ShortcutDef } from './useShortcuts'

/**
 * 作用域快捷键：active 为真时批量注册、为假时批量注销，组件卸载自动清理；键位进 useShortcuts
 * 统一注册表，受 scope 优先级（modal>editor>view>global）与命中消费策略仲裁，替代手写 window 监听（show 时 add / hide 时 remove），适用于浮层（弹窗/下拉/抽屉）的临时键位。@example：
 * useScopedShortcuts([{ id: 'my-modal.close', keys: ['escape'], description: '关闭弹窗', scope: 'modal', handler: () => show.value = false }], show)
 */
export function useScopedShortcuts(
  defs: ShortcutDef[] | (() => ShortcutDef[]),
  active: Ref<boolean> | (() => boolean),
) {
  const { register, unregister } = useShortcuts()
  const isActive = typeof active === 'function' ? active : () => active.value
  let registeredIds: string[] = []

  function apply(on: boolean) {
    if (on) {
      if (registeredIds.length > 0) return
      const list = typeof defs === 'function' ? defs() : defs
      registeredIds = list.map(d => {
        register({ ...d })
        return d.id
      })
    } else {
      registeredIds.forEach(id => unregister(id))
      registeredIds = []
    }
  }

  watch(isActive, v => apply(v), { immediate: true })
  onBeforeUnmount(() => apply(false))
}
