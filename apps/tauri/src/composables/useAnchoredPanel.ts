import { ref, onMounted, onBeforeUnmount, type ComponentPublicInstance } from 'vue'

/**
 * 锚定小面板的定位 + 点击外部关闭（批3 归一：此前 正文 Aa/统计 + 笔记本 Aa 三处各写一份）。
 * 形态 = fixed 小卡，锚在触发按钮下方右对齐（bottomGuard 预留视口底部护栏）。
 * 用法：组件内 `const { panelRef, panelStyle } = useAnchoredPanel(() => props.anchor, () => emit('close'))`，
 * 模板根节点绑 `:ref="panelRef"`（函数 ref，panelRef 可在脚本内做 contains 判定）与 `:style="panelStyle"`。
 */
export function useAnchoredPanel(
  anchor: () => HTMLElement | null,
  close: () => void,
  opts: { /** 视口底部预留高度（面板 top 的钳位护栏） */ bottomGuard?: number } = {},
): {
  /** 函数式 ref（模板 `:ref="panelRef"` 绑根节点） */
  panelRef: (el: Element | ComponentPublicInstance | null) => void
  panelStyle: import('vue').Ref<{ top: string; right: string }>
} {
  const bottomGuard = opts.bottomGuard ?? 320
  const panelEl = ref<HTMLElement | null>(null)
  const panelStyle = ref<{ top: string; right: string }>({ top: '0px', right: '0px' })

  function panelRef(el: Element | ComponentPublicInstance | null): void {
    panelEl.value = (el as HTMLElement) ?? null
  }

  function position(): void {
    const rect = anchor()?.getBoundingClientRect()
    if (!rect) return
    panelStyle.value = {
      top: `${Math.min(rect.bottom + 6, window.innerHeight - bottomGuard)}px`,
      right: `${window.innerWidth - rect.right}px`,
    }
  }

  function onDocMousedown(e: MouseEvent): void {
    const t = e.target as Node
    if (panelEl.value?.contains(t)) return
    if (anchor()?.contains(t)) return
    close()
  }

  onMounted(() => {
    position()
    document.addEventListener('mousedown', onDocMousedown)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMousedown)
  })

  return { panelRef, panelStyle }
}
