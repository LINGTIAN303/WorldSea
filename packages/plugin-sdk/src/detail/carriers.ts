import type { Component } from 'vue'
import EntityDetailPanel from '../components/EntityDetailPanel.vue'
import ColumnDetailView from '../components/ColumnDetailView.vue'

/**
 * L1 载体形态注册表：详情**装在哪个容器里、占多大空间、怎么进出**。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 *
 * 与 L2 内容形态（`contentForms.ts`）是两级：换容器不动编排，换编排不动容器。
 * 载体之间**只差容器**——属性、事件、槽名、暴露面必须逐一对齐（`useDetailChrome` 就是这个契约的实现处），
 * 否则每加一种载体，GEV 的详情段就要重写一遍（1a 之前的四套字段控件正是这么长出来的）。
 */

/** overlay＝压在列表上的浮层（带遮罩）；split＝与列表同排分栏（不遮列表） */
export type CarrierMode = 'overlay' | 'split'

export interface CarrierDefinition {
  /** 载体 id，存进 `worldsea_detail_carriers` */
  carrier: string
  label: string
  /** WsIcon 的 name（项目禁用 emoji 图标） */
  icon: string
  description: string
  mode: CarrierMode
  component: Component
}

/** 缺省载体＝抽屉：芽不声明、用户不设，观感与批次 2 之前完全一致 */
export const DEFAULT_CARRIER = 'drawer'

const registry = new Map<string, CarrierDefinition>()

/** 幂等注册：重复注册同 id 直接跳过 */
export function registerCarrier(def: CarrierDefinition): void {
  if (registry.has(def.carrier)) return
  registry.set(def.carrier, def)
}

export function getCarrier(carrier: string): CarrierDefinition | undefined {
  return registry.get(carrier)
}

/** 注册顺序即设置面里的可选顺序 */
export function allCarriers(): CarrierDefinition[] {
  return Array.from(registry.values())
}

/** 未注册 id（芽写错、载体被撤）一律回落缺省载体——详情不能因为配置写错就点不开 */
export function activeCarrier(carrier: string): CarrierDefinition {
  return registry.get(carrier) ?? registry.get(DEFAULT_CARRIER)!
}

const BUILT_IN_CARRIERS: CarrierDefinition[] = [
  {
    carrier: 'drawer',
    label: '右栏抽屉',
    icon: 'panel-right',
    mode: 'overlay',
    description: '压在列表上的右栏浮层，带遮罩与滑入动效（缺省）',
    component: EntityDetailPanel,
  },
  {
    carrier: 'column',
    label: '栏式整页',
    icon: 'panel-right-open',
    mode: 'split',
    description: '与列表同排分栏，不遮列表；适合边翻列表边读详情',
    component: ColumnDetailView,
  },
]

for (const def of BUILT_IN_CARRIERS) registerCarrier(def)
