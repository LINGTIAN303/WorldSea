import { onBeforeUnmount, type Ref } from 'vue'
import { mapScrollTop, collectHeadingOffsets } from './splitScrollSync'

/**
 * 分栏双向滚动同步（批 4 V8/I10）：标题锚点映射 + 双向防环。
 *
 * 抽自 NotebookTipTapEditor（2026-10-18 拆件）：两个 pane 的 ref 由调用方持有，
 * 本组合函数只管监听挂接 / 解除与同步算法，不关心视图态语义（是否分栏由 active 参数决定）。
 */
export function useSplitScrollSync(
  editPaneRef: Ref<HTMLElement | null>,
  previewPaneRef: Ref<HTMLElement | null>,
) {
  let syncOwner: 'editor' | 'preview' | null = null
  let syncAt = 0
  let detach: (() => void) | null = null

  function applySync(source: 'editor' | 'preview'): void {
    const ed = editPaneRef.value
    const pv = previewPaneRef.value
    if (!ed || !pv) return
    const from = source === 'editor' ? ed : pv
    const to = source === 'editor' ? pv : ed
    const target = mapScrollTop(
      collectHeadingOffsets(from),
      collectHeadingOffsets(to),
      Math.max(0, from.scrollHeight - from.clientHeight),
      Math.max(0, to.scrollHeight - to.clientHeight),
      from.scrollTop,
    )
    // 差值过小时跳过赋值：避免生成无意义的 scroll 回声（防环第二道保险）
    if (Math.abs(to.scrollTop - target) > 2) to.scrollTop = target
  }

  function onPaneScroll(source: 'editor' | 'preview'): void {
    const now = performance.now()
    // 另一侧刚带动我（150ms 回声窗内）→ 忽略；这是防环第一道保险
    if (syncOwner !== source && now - syncAt < 150) return
    syncOwner = source
    syncAt = now
    applySync(source)
  }

  /** 仅分栏模式挂双向滚动监听；切走或卸载时解除 */
  function attachSplitSync(active: boolean): void {
    detach?.()
    detach = null
    if (!active) return
    const ed = editPaneRef.value
    const pv = previewPaneRef.value
    if (!ed || !pv) return
    const onEd = () => onPaneScroll('editor')
    const onPv = () => onPaneScroll('preview')
    ed.addEventListener('scroll', onEd, { passive: true })
    pv.addEventListener('scroll', onPv, { passive: true })
    detach = () => {
      ed.removeEventListener('scroll', onEd)
      pv.removeEventListener('scroll', onPv)
    }
  }

  /** 首次进入分栏：清掉防环归属，以编辑侧为准对齐一次 */
  function alignToEditor(): void {
    syncOwner = null
    applySync('editor')
  }

  onBeforeUnmount(() => { detach?.() })

  return { attachSplitSync, alignToEditor, applySync }
}
