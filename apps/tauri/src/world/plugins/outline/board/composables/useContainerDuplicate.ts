import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { genBoardId, type OutlineBoardLayout } from '../layoutSchema'
import { cloneContainerIntoLayout } from '../duplicateContainer'
import { syncParentChildRelation } from '../../parentChildSync'

interface Options {
  /** 当前布局（getter：避免持有过期快照） */
  layout: () => OutlineBoardLayout
  /** 整体替换布局（useBoardLayout.replaceLayout，走统一保存链） */
  replaceLayout: (next: OutlineBoardLayout) => void
  /** 记录撤销快照（useBoardUndo.record） */
  recordUndo: () => void
  /** 选中新容器（useBoardSelection.select） */
  select: (containerId: string) => void
}

/**
 * 复制容器（2026-10-18，Q1=A「复制节点 + 容器」）。
 *
 * 一次调用完成：建节点 → 复制组件配置与尺寸到新容器 → 选中新容器。
 *
 * 取值口径（用户 2026-10-18 拍板）：
 * - Q2 命名：`原名 副本`，重名递增 `副本 2/3…`（不弹窗）
 * - Q3 **不复制关联章节**（章节是「1 节点 ↔ 1 章节」语义）
 * - Q4 **不复制任何关系**（跨芽 + 横向；复制会产生成倍重复边）
 * - Q5 位置：源容器右下偏移 +24/+24
 *
 * 撤销：与「空白双击新建节点」同口径——`recordUndo()` 记布局快照，
 * 撤销回滚布局，节点保留为「未入板」（与既有建节点行为一致，不引入第二套撤销机制）。
 */
export function useContainerDuplicate(opts: Options) {
  const es = useEntityStore()

  /** 新节点名：`原名 副本`，重名递增（去掉原有「副本 N」后缀再拼，避免「副本 副本」） */
  function copyNodeName(base: string): string {
    const names = new Set(
      (es.entities ?? []).filter(e => e.type === 'outline_node').map(e => (e.name ?? '').trim()),
    )
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
    const srcNode: Entity | undefined = es.entityMap.get(src.nodeId)
    if (!srcNode) return

    opts.recordUndo()
    const now = new Date().toISOString()
    const nodeId = genBoardId('out')
    const parentId = String((srcNode.properties?.parentId as string) || '')
    const siblings = (es.entities ?? []).filter(
      e => e.type === 'outline_node' && ((e.properties?.parentId as string) || '') === parentId,
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
    // 层级双写的关系同步（与其它建节点路径一致；根节点无父级则跳过）
    if (parentId) await syncParentChildRelation(nodeId, parentId)

    const cloned = cloneContainerIntoLayout(opts.layout(), containerId, nodeId)
    if (!cloned) return
    opts.replaceLayout(cloned.layout)
    opts.select(cloned.containerId)
  }

  return { duplicateContainer }
}
