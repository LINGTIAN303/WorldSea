/**
 * sectionLayout —— 区排布的纯布局变换（2026-10-24 · 13-D）
 *
 * 从 `useBoardLayout.applyArrange` 抽出的纯函数：只重算指定区内容器的坐标，
 * 不改区/容器的其它字段。
 *
 * 抽出的两个目的：
 * 1. 可单测（jsdom 拿不到真实尺寸，排布必须留在纯函数层）；
 * 2. 让 `settleContainerSection` 在拖动结束时把「归属 + 钳顶 + 重排」做成一次 mutate，
 *    同时不撑大 `useBoardLayout` 的冻结行数。
 */
import { arrangeSection, type ArrangeItem } from './sectionArrange'
import {
  containersOfSection,
  findSection,
  rectOfContainer,
  type OutlineBoardLayout,
} from './layoutSchema'

/** 按区的 arrange 重算其内容器坐标；区不存在或 free 时原样返回 */
export function arrangeSectionInLayout(
  layout: OutlineBoardLayout,
  sectionId: string,
): OutlineBoardLayout {
  const s = findSection(layout, sectionId)
  if (!s) return layout
  const items: ArrangeItem[] = containersOfSection(layout, sectionId).map(c => {
    const r = rectOfContainer(c)
    return { id: c.id, x: r.x, y: r.y, w: r.w, h: r.h }
  })
  const placed = arrangeSection(items, s.rect, s.arrange)
  const posById = new Map(placed.map(p => [p.id, p] as const))
  return {
    ...layout,
    containers: layout.containers.map(c => {
      const p = posById.get(c.id)
      return p ? { ...c, pos: { x: p.x, y: p.y } } : c
    }),
  }
}
