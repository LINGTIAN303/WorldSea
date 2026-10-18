import { computed, ref } from 'vue'
import { useEntityStore, useRelationStore, type Entity } from '@worldsea/entity-core'
import { genBoardId, type OutlineBoardLayout } from '../layoutSchema'
import { cloneContainerIntoLayout } from '../duplicateContainer'
import { syncParentChildRelation } from '../../parentChildSync'
import {
  childrenOf,
  collectSubtreeIds,
  deleteOutlineNodeWithStrategy,
  type ChildStrategy,
  type OutlineNodeDeleteApi,
} from '@/entity/outlineNodeDelete'
import { unlinkNode } from '@/entity/chapterLink'

interface Options {
  layout: () => OutlineBoardLayout
  replaceLayout: (next: OutlineBoardLayout) => void
  recordUndo: () => void
  select: (containerId: string) => void
  clearSelection: () => void
  toast?: (message: string) => void
}

interface DeleteTarget {
  id: string
  name: string
  childCount: number
  candidates: Array<{ id: string; name: string }>
}

/**
 * 白板节点动作：**复制容器** 与 **删除节点**（2026-10-19）。
 *
 * 语义边界（用户 2026-10-19 拍板）：
 * - 「移除出画布」= 只删容器、节点留右栏 → 不归本模块（`useBoardLayout.removeContainerById`）。
 * - 「删除」= 删节点 + 容器 + 全部关系 + 章节解绑 → 本模块；有子节点时弹四选项对话框。
 *
 * 独立成文件的原因：`BoardView.tsx` 已处 1230 行冻结基线，任何新逻辑都不许再进去。
 */
export function useBoardNodeActions(opts: Options) {
  const es = useEntityStore()
  const rs = useRelationStore()

  const outlineNodes = computed<Entity[]>(
    () => (es.entities ?? []).filter(e => e.type === 'outline_node'),
  )

  /** 删除 API 适配（store → 纯逻辑模块的最小接口） */
  const deleteApi: OutlineNodeDeleteApi = {
    entities: () => es.entities ?? [],
    relations: () => rs.relations ?? [],
    removeEntity: (id) => es.remove(id),
    removeRelation: (id) => rs.remove(id),
    unlinkChapter: (nodeId) => unlinkNode(es, nodeId),
    updateNode: async (id, properties) => {
      const node = es.entityMap.get(id)
      if (!node) return
      // 实体更新对 properties 是整体替换 → 必须先合并
      await es.update(id, { properties: { ...(node.properties ?? {}), ...properties } })
    },
  }

  // ── 复制容器（Q1=A） ─────────────────────

  function copyNodeName(base: string): string {
    const names = new Set(outlineNodes.value.map(e => (e.name ?? '').trim()))
    const root = `${base.replace(/ 副本( \d+)?$/, '').trim() || '未命名'} 副本`
    if (!names.has(root)) return root
    let i = 2
    while (names.has(`${root} ${i}`)) i += 1
    return `${root} ${i}`
  }

  async function duplicateContainer(containerId: string): Promise<void> {
    const layout = opts.layout()
    const src = layout.containers.find(c => c.id === containerId)
    if (!src) return
    const srcNode = es.entityMap.get(src.nodeId)
    if (!srcNode) return

    opts.recordUndo()
    const now = new Date().toISOString()
    const nodeId = genBoardId('out')
    const parentId = String((srcNode.properties?.parentId as string) || '')
    const siblings = outlineNodes.value.filter(
      n => ((n.properties?.parentId as string) || '') === parentId,
    )
    await es.add({
      id: nodeId,
      type: 'outline_node',
      name: copyNodeName(srcNode.name ?? '未命名'),
      description: srcNode.description ?? '',
      properties: {
        ...(srcNode.properties ?? {}),
        order: siblings.length + 1,
        parentId,
        manuscriptId: '', // Q3：不复制关联章节
      },
      tags: [...(srcNode.tags ?? [])],
      createdAt: now,
      updatedAt: now,
    })
    if (parentId) await syncParentChildRelation(nodeId, parentId)

    const cloned = cloneContainerIntoLayout(opts.layout(), containerId, nodeId)
    if (!cloned) return
    opts.replaceLayout(cloned.layout)
    opts.select(cloned.containerId)
  }

  // ── 删除节点（四策略） ───────────────────

  const deleteTarget = ref<DeleteTarget | null>(null)
  const deleteDialogOpen = computed(() => deleteTarget.value !== null)

  /** 打开删除确认框（无子节点时也走同一框：破坏性操作必须确认） */
  function askDeleteNode(nodeId: string): void {
    const node = es.entityMap.get(nodeId)
    if (!node || node.type !== 'outline_node') return
    const nodes = outlineNodes.value
    const excluded = new Set(collectSubtreeIds(nodes, nodeId))
    deleteTarget.value = {
      id: nodeId,
      name: (node.name ?? '').trim() || '未命名',
      childCount: childrenOf(nodes, nodeId).length,
      // 目标不能是自身子树里的节点（否则成环）
      candidates: nodes
        .filter(n => !excluded.has(n.id))
        .map(n => ({ id: n.id, name: (n.name ?? '').trim() || '未命名' })),
    }
  }

  function cancelDelete(): void {
    deleteTarget.value = null
  }

  async function confirmDelete(strategy: ChildStrategy, reparentTargetId: string): Promise<void> {
    const target = deleteTarget.value
    if (!target) return
    const nodes = outlineNodes.value
    // 先算出将被删的节点集合（用于同步清理画布上的容器）
    const doomed = new Set(
      strategy === 'cascade' ? collectSubtreeIds(nodes, target.id) : [target.id],
    )
    const removed = await deleteOutlineNodeWithStrategy(
      deleteApi,
      target.id,
      strategy,
      reparentTargetId,
    )
    // 布局侧同步移除这些节点的容器（否则画布上留下「节点已删除」的悬空容器）
    const layout = opts.layout()
    const containers = layout.containers.filter(c => !doomed.has(c.nodeId))
    if (containers.length !== layout.containers.length) {
      opts.replaceLayout({ ...layout, containers })
    }
    opts.clearSelection()
    deleteTarget.value = null
    opts.toast?.(`已删除 ${removed} 个节点`)
  }

  return { duplicateContainer, askDeleteNode, cancelDelete, confirmDelete, deleteTarget, deleteDialogOpen }
}
