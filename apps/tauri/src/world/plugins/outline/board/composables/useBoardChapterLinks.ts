import { computed, ref } from 'vue'
import { useEntityStore, useRelationStore, type Entity } from '@worldsea/entity-core'
import { buildChapterLinkIndex, CHAPTER_TYPE, type ChapterLinkIndex } from '@/entity/chapterLink'

/** 白板章节索引：章节列表、章节↔节点索引、已关联节点名、容器「打开正文」集合。 */
export function useBoardChapterLinks() {
  const es = useEntityStore()
  const rs = useRelationStore()
  const chapters = ref<Entity[]>([])
  const index = ref<ChapterLinkIndex>({ nodeByChapter: new Map(), chapterByNode: new Map() })

  async function refresh(): Promise<void> {
    const all = await es.getAllEntities()
    chapters.value = all.filter(e => e.type === CHAPTER_TYPE)
    index.value = buildChapterLinkIndex(all, rs.relations ?? [])
  }

  const chapterNodeNames = computed(() => {
    const byId = new Map(
      (es.entities ?? []).filter(e => e.type === 'outline_node').map(e => [e.id, e]),
    )
    const out = new Map<string, string>()
    for (const [chapterId, nodeId] of index.value.nodeByChapter) {
      out.set(chapterId, (byId.get(nodeId)?.name ?? '').trim() || '未命名节点')
    }
    return out
  })

  const chapterNodeIds = computed(() => new Set(index.value.chapterByNode.keys()))

  return { chapters, index, chapterNodeNames, chapterNodeIds, refresh }
}
