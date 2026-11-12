import { computed, onMounted, onUnmounted, ref } from 'vue'
import { type Entity } from '@worldsea/entity-core'
import { chapterLinkStore, chapterRelationStore, entitiesSvc, relationsSvc } from '../../serviceAccess'
import { genBoardId, type OutlineBoardLayout } from '../layoutSchema'
import { cloneContainerIntoLayout } from '../duplicateContainer'
import { syncParentChildRelation } from '../../parentChildSync'
import {
  childrenOf,
  collectSubtreeIds,
  deleteOutlineNodeWithStrategy,
  deleteOutlineNodes,
  type ChildStrategy,
  type OutlineNodeDeleteApi,
} from '@/entity/outlineNodeDelete'
import { buildChapterLinkIndex, linkChapterToNode, unlinkNode } from '@/entity/chapterLink'
import type { EntityDeletePayload } from './useBoardUndo'

interface Options {
  layout: () => OutlineBoardLayout
  replaceLayout: (next: OutlineBoardLayout) => void
  recordUndo: () => void
  /** 删除前的完整记录（实体 + 关系 + 章节 + 前后布局），使一次 Ctrl+Z 能整批恢复 */
  recordEntityDelete: (payload: EntityDeletePayload) => void
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
  const es = entitiesSvc()
  const rs = relationsSvc()

  const outlineNodes = computed<Entity[]>(
    () => (es.list() ?? []).filter(e => e.type === 'outline_node'),
  )

  /** 删除 API 适配（store → 纯逻辑模块的最小接口） */
  const deleteApi: OutlineNodeDeleteApi = {
    entities: () => es.list() ?? [],
    relations: () => rs.list() ?? [],
    removeEntity: (id) => es.remove(id),
    removeRelation: (id) => rs.remove(id),
    unlinkChapter: (nodeId) => unlinkNode(chapterLinkStore(), chapterRelationStore(), nodeId),
    updateNode: async (id, properties) => {
      const node = es.get(id)
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
    const srcNode = es.get(src.nodeId)
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
    const node = es.get(nodeId)
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
    const doomed = new Set(strategy === 'cascade' ? collectSubtreeIds(nodes, target.id) : [target.id])
    const doomedNodes = nodes.filter(n => doomed.has(n.id))
    const doomedRelations = (rs.list() ?? []).filter(
      r => doomed.has(r.sourceId) || doomed.has(r.targetId),
    )
    const linkIndex = buildChapterLinkIndex(es.list() ?? [], rs.list() ?? [])
    const chapterLinks = (es.list() ?? [])
      .filter(e => e.type === 'manuscript')
      .map(c => ({ chapterId: c.id, nodeId: linkIndex.nodeByChapter.get(c.id) ?? '' }))
      .filter(l => l.nodeId && doomed.has(l.nodeId))
    // promote / reparent 会改子节点的 parentId/order —— 撤销时须写回原值
    const restoreNodes = (strategy === 'cascade' ? [] : childrenOf(nodes, target.id)).map(k => ({
      id: k.id,
      properties: {
        parentId: String((k.properties?.parentId as string) || ''),
        order: Number(k.properties?.order ?? 0),
      },
    }))
    const before = opts.layout()
    const after = { ...before, containers: before.containers.filter(c => !doomed.has(c.nodeId)) }

    // 删除前登记：一次 Ctrl+Z 能把节点、关系、章节绑定与容器整批恢复
    opts.recordEntityDelete({
      nodes: doomedNodes,
      relations: doomedRelations,
      chapterLinks,
      restoreNodes,
      before: { layout: before },
      after: { layout: after },
    })

    const removed = await deleteOutlineNodeWithStrategy(
      deleteApi,
      target.id,
      strategy,
      reparentTargetId,
    )
    if (after.containers.length !== before.containers.length) opts.replaceLayout(after)
    opts.clearSelection()
    deleteTarget.value = null
    opts.toast?.(`已删除 ${removed} 个节点（Ctrl+Z 可撤销）`)
  }

  /** 撤销删除：先写回被改动的子节点，再按原 id 重建节点/关系/章节绑定 */
  async function restoreEntities(payload: EntityDeletePayload): Promise<void> {
    for (const r of payload.restoreNodes ?? []) await deleteApi.updateNode(r.id, r.properties)
    for (const n of payload.nodes) await es.add(n)
    for (const r of payload.relations) await rs.add(r)
    for (const l of payload.chapterLinks) await linkChapterToNode(chapterLinkStore(), chapterRelationStore(), l.chapterId, l.nodeId)
  }

  /** 重做删除：再删一次（关系与章节绑定由 deleteOutlineNodes 一并清理） */
  async function removeEntities(payload: EntityDeletePayload): Promise<void> {
    await deleteOutlineNodes(deleteApi, payload.nodes.map(n => n.id))
  }

  /**
   * 跨组件删除请求（2026-10-19）：表格式的「管理行」等派生型形式不持有本 composable 实例，
   * 通过事件把删除意图送回这里——**保证删除永远只有一条路径**（四策略对话框 + 撤销记录）。
   */
  function onDeleteRequest(e: Event): void {
    const nodeId = (e as CustomEvent<{ nodeId?: string }>).detail?.nodeId
    if (nodeId) askDeleteNode(nodeId)
  }
  onMounted(() => window.addEventListener('ws-outline-delete-node', onDeleteRequest))
  onUnmounted(() => window.removeEventListener('ws-outline-delete-node', onDeleteRequest))

  return {
    duplicateContainer,
    askDeleteNode,
    cancelDelete,
    confirmDelete,
    restoreEntities,
    removeEntities,
    deleteTarget,
    deleteDialogOpen,
  }
}
