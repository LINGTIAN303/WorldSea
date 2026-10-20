import type { useEntityStore } from '@worldsea/entity-core'
import { genBoardId } from '../layoutSchema'
import { resolveChildNodes } from '../outlineDerive'
import { syncParentChildRelation } from '../../parentChildSync'

type Store = ReturnType<typeof useEntityStore>

/**
 * 在指定节点下新建一个子节点（未入板），返回新 id（2026-10-19）。
 *
 * 列表型形式（标题式 / 句子式 / 表格式）的「＋ 添加」共用这一个入口——
 * 避免每个组件各写一份建节点逻辑（字段初始化一旦漂移就会写出不同的 properties）。
 *
 * 写入纪律：与「空白双击新建」同口径（建节点 + 同步 parent_child），不进布局撤销栈。
 */
export async function createChildNode(
  es: Store,
  parentId: string,
  name = '新节点',
): Promise<string> {
  const now = new Date().toISOString()
  const nodes = (es.entities ?? []).filter(e => e.type === 'outline_node')
  const siblings = resolveChildNodes(parentId, nodes)
  const id = genBoardId('out')
  await es.add({
    id,
    type: 'outline_node',
    name,
    description: '',
    properties: {
      status: '未写',
      order: siblings.length + 1,
      parentId,
      storylines: '',
    },
    tags: [],
    createdAt: now,
    updatedAt: now,
  } as never)
  await syncParentChildRelation(id, parentId)
  return id
}
