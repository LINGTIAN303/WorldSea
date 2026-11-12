/**
 * 「打开正文」外部导航（2026-10-08）——把 `ws-navigate` / `ws-select-entity` 的
 * 章节跳转（大纲 Inspector「打开正文」）落到「打开归属书 + 打开该章节」。
 *
 * 双通道与 GEV / TimelineView 同款：
 * 1. 事件通道（视图已挂载时）：监听 `ws-select-entity`；
 * 2. 挂起位兜底（视图挂载晚于事件派发）：等 store 就绪后读 `ui.selectedEntityId()`
 *    （同 CharacterList 的兜底口径——本视图 onMounted 的 loadAll 与这里不保序）。
 *
 * 本件**自注册生命周期**（在 setup 中调用即可）：宿主 ManuscriptView 是冻结件（余量 0），
 * 接线全部收在这里，宿主只加 import + 调用两行。
 *
 * 降级语义：章节实体不存在/类型不符 → no-op（保持书列表）；bookId 失效 → 落到「未归书」层。
 */
import { onMounted, onBeforeUnmount } from 'vue'
import { type Entity } from '@worldsea/entity-core'
import { entitiesSvc, uiSvc } from '../serviceAccess'

interface ExternalNavDeps {
  /** 打开书籍层（宿主 openBook；'' = 未归书虚拟组），完成后再开章节（其内部会 flushSave + 清 current） */
  openBook: (bookId: string) => Promise<void>
  /** 打开章节编辑器（宿主 select） */
  openChapter: (chapter: Entity) => void
}

export function useManuscriptExternalNav(deps: ExternalNavDeps): void {
  const es = entitiesSvc()
  const ui = uiSvc()

  function navigateTo(id: string | undefined | null): void {
    if (!id) return
    const entity = es.get(id)
    if (!entity || entity.type !== 'manuscript') return
    const bookId = String(entity.properties?.bookId ?? '')
    const validBook = bookId && es.get(bookId)?.type === 'book' ? bookId : ''
    // openBook 内部 await flushSave() 后会把 current 置空——必须先落书、再开章（顺序不可颠倒）
    void deps.openBook(validBook).then(() => deps.openChapter(entity))
  }

  function onWsSelectEntity(e: Event) {
    navigateTo((e as CustomEvent).detail?.entityId as string | undefined)
  }

  onMounted(() => {
    window.addEventListener('ws-select-entity', onWsSelectEntity)
    void es.reload().then(() => navigateTo(ui.selectedEntityId())) // 挂起位兜底（见 Shell.onWsNavigate）
  })
  onBeforeUnmount(() => {
    window.removeEventListener('ws-select-entity', onWsSelectEntity)
  })
}
