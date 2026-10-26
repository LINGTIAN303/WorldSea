import { onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { Entity } from '@worldsea/entity-core'
import type { SaveStatus } from './useChapterEditor'

/**
 * 自动快照（批1 防丢稿）：定时 tick，条件全满足才拍——
 * ①有当前章节与编辑器 ②落盘已完成（saveStatus==='saved'，避开防抖窗口的落盘竞态）
 * ③非空文档；内容与最近一次快照相同由 createSnapshot(auto) 内部短路。
 * 切章/卸载不重置定时器（内容对比已兜底误拍）。
 */

export const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000

export function useAutoSnapshot(deps: {
  currentChapter: Ref<Entity | null>
  editor: Ref<Editor | undefined>
  saveStatus: Ref<SaveStatus>
  createAutoSnapshot: (content: string, wordCount: number) => Promise<void>
}) {
  let timer: ReturnType<typeof setInterval> | null = null

  async function tick() {
    const ed = deps.editor.value
    if (!deps.currentChapter.value || !ed) return
    if (deps.saveStatus.value !== 'saved') return
    const html = ed.getHTML()
    const text = ed.getText()
    if (!text.length) return
    await deps.createAutoSnapshot(html, text.length)
  }

  onMounted(() => {
    timer = setInterval(() => void tick(), AUTO_SNAPSHOT_INTERVAL_MS)
  })

  onBeforeUnmount(() => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  })
}
