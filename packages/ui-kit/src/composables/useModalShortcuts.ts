import { watch, onBeforeUnmount, type Ref } from 'vue'
import { useShortcuts, setShortcutModalActive, pushModalShortcut, popModalShortcut, type ShortcutScope } from './useShortcuts'

export interface ModalShortcutOptions {
  /** 弹窗内快捷键条目 id（如 'entity-form.close'） */
  id: string
  /** 关闭回调（Esc 触发） */
  onEscape: () => void
  description?: string
  /** 额外的弹窗期键位（modal 层，如 Enter 确认） */
  extraDefs?: { id: string; keys: string[]; description: string; handler: () => void; preventDefault?: boolean }[]
}

/**
 * 弹窗快捷键组合器（自挂监听弹窗的统一收编入口）：① Esc 关闭收编进注册表 modal 层（scope 优先级
 * 天然高于 view/global，不被命中消费阻断——修复「弹窗 Esc 关不掉」）；② 弹窗打开期间接入注册表弹窗深度
 * （view/global 层全部失效防穿透），关闭/卸载时出栈。新弹窗一律用本组合器替代手挂 keydown 监听。
 */
export function useModalShortcuts(
  show: Ref<boolean> | (() => boolean),
  opts: ModalShortcutOptions,
) {
  const { register, unregister } = useShortcuts()
  const isVisible = typeof show === 'function' ? show : () => show.value
  let guardActive = false

  function apply(on: boolean) {
    if (on) {
      register({ id: opts.id, keys: ['escape'], description: opts.description ?? '关闭弹窗', scope: 'modal' as ShortcutScope, handler: opts.onEscape })
      for (const d of opts.extraDefs ?? []) {
        register({ ...d, scope: 'modal' as ShortcutScope })
      }
      pushModalShortcut(opts.id)
      if (!guardActive) { setShortcutModalActive(true); guardActive = true }
    } else {
      popModalShortcut(opts.id)
      unregister(opts.id)
      for (const d of opts.extraDefs ?? []) unregister(d.id)
      if (guardActive) { setShortcutModalActive(false); guardActive = false }
    }
  }

  watch(isVisible, v => apply(v), { immediate: true })
  onBeforeUnmount(() => apply(false))
}
