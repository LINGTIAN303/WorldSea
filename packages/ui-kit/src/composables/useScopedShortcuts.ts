import { watch, onBeforeUnmount, type Ref } from 'vue'
import { useShortcuts, type ShortcutDef } from './useShortcuts'

/**
 * 作用域快捷键：active 为真时批量注册、为假时批量注销，组件卸载自动清理。
 *
 * 用途：浮层（弹窗/下拉/抽屉）的临时键位（如 Escape 关闭、Enter 确认），
 * 替代手写「show 时 addEventListener / hide 时 removeEventListener」的 window 监听。
 * 注册进 useShortcuts 统一注册表后，键位受 scope 优先级（modal>editor>view>global）
 * 与命中消费策略统一仲裁，不再与全局键双触发。
 *
 * @example
 * const show = ref(false)
 * useScopedShortcuts([
 *   { id: 'my-modal.close', keys: ['escape'], description: '关闭弹窗', scope: 'modal', handler: () => show.value = false },
 * ], show)
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
