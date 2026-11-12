import { computed, ref } from 'vue'
import { type Entity } from '@worldsea/entity-core'
import { entitiesSvc, relationsSvc } from '../../serviceAccess'
import { buildChapterLinkIndex, CHAPTER_TYPE, type ChapterLinkIndex } from '@/entity/chapterLink'

/** 白板章节索引：章节列表、章节↔节点索引、已关联节点名、容器「打开正文」集合。 */
export function useBoardChapterLinks() {
  const es = entitiesSvc()
  const rs = relationsSvc()
  const chapters = ref<Entity[]>([])
  const index = ref<ChapterLinkIndex>({ nodeByChapter: new Map(), chapterByNode: new Map() })

  async function refresh(): Promise<void> {
    // 对应原 `es.getAllEntities()`：只读磁盘取快照，不改内存态（见 WorldEntitiesService.getAll）
    const all = await es.getAll()
    chapters.value = all.filter(e => e.type === CHAPTER_TYPE)
    index.value = buildChapterLinkIndex(all, [...rs.list()])
  }

  const chapterNodeNames = computed(() => {
    const byId = new Map(
      (es.list() ?? []).filter(e => e.type === 'outline_node').map(e => [e.id, e]),
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
