import {
  createComponent,
  createContainer,
  findContainer,
  findContainerByNode,
  type OutlineBoardLayout,
} from './layoutSchema'
import type { Point } from './boardGeometry'

export interface CloneContainerResult {
  layout: OutlineBoardLayout
  containerId: string
}

/**
 * 布局侧的容器复制（纯函数，2026-10-18 Q1=A「复制节点 + 容器」）。
 *
 * 把 `srcId` 的组件配置与尺寸克隆到**新节点** `newNodeId` 上：
 * - 组件：新 id、保留 `form` / `order` / `config`（config 浅拷贝，避免两容器共享同一对象）
 * - 尺寸：跟随源容器（源为内容自适应时不复制 `size`）
 * - 归属区：跟随源容器；**折叠态不复制**（新容器必须可见）
 *
 * 独立成文件的原因：`useBoardLayout.ts` 已处于 400 行冻结基线（444 行），不得再增长。
 */
export function cloneContainerIntoLayout(
  layout: OutlineBoardLayout,
  srcId: string,
  newNodeId: string,
  offset: Point = { x: 24, y: 24 },
): CloneContainerResult | null {
  const src = findContainer(layout, srcId)
  if (!src || !newNodeId) return null
  if (findContainerByNode(layout, newNodeId)) return null
  const container = createContainer(
    newNodeId,
    { x: Math.round(src.pos.x + offset.x), y: Math.round(src.pos.y + offset.y) },
    src.sectionId ? { sectionId: src.sectionId } : {},
  )
  container.components = src.components.map((c) => {
    const created = createComponent(c.form, c.order)
    if (c.config && Object.keys(c.config).length) created.config = { ...c.config }
    return created
  })
  if (src.size) container.size = { ...src.size }
  return {
    layout: { ...layout, containers: [...layout.containers, container] },
    containerId: container.id,
  }
}
