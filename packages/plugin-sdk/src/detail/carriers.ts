import type { Component } from 'vue'
import EntityDetailPanel from '../components/EntityDetailPanel.vue'
import ColumnDetailView from '../components/ColumnDetailView.vue'
import ModalDetailView from '../components/ModalDetailView.vue'
import ImmersiveDetailView from '../components/ImmersiveDetailView.vue'
import FloatingDetailView from '../components/FloatingDetailView.vue'

/**
 * L1 载体形态注册表：详情**装在哪个容器里、占多大空间、怎么进出**。与 L2 内容形态（`contentForms.ts`）
 * 两级：换容器不动编排、换编排不动容器；载体间**只差容器**——属性/事件/槽名/暴露面逐一对齐（`useDetailChrome`
 * 是契约实现处）。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十
 */

/** overlay＝压在列表上的浮层；split＝与列表同排分栏；immersive＝盖住整块内容区 */
export type CarrierMode = 'overlay' | 'split' | 'immersive'

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

/** 缺省载体＝抽屉：芽不声明、用户不设，观感与引入载体注册前完全一致 */
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

/**
 * 载体优先序的**唯一解析口**：用户按类型的覆写 > 芽声明 > 缺省抽屉。
 * GEV 与时间线两个调用点必须同序，所以不在各自组件里拼 `||`——拼第二次就是第二条真值路径。
 */
export function resolveCarrier(storedOverride?: string, declared?: string): string {
  return storedOverride || declared || DEFAULT_CARRIER
}

/**
 * 宽度持久化键：按「载体 + 实体类型」分键，同一类型下抽屉与分栏各记各的。
 * 缺省抽屉沿用历史键名（`PANEL_LABELS` 里的中文标签继续认得出），其余载体带载体名前缀。
 */
export function carrierPanelId(carrier: string, entityType: string): string {
  return carrier === DEFAULT_CARRIER ? `detail-${entityType}` : `detail-${carrier}-${entityType}`
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
  {
    carrier: 'modal',
    label: '居中弹层',
    icon: 'square',
    mode: 'overlay',
    description: '屏幕居中的弹层，读一条实体时最聚焦；遮罩档位与抽屉共用',
    component: ModalDetailView,
  },
  {
    carrier: 'immersive',
    label: '沉浸页',
    icon: 'expand',
    mode: 'immersive',
    description: '详情铺满整个内容区（列表盖在下面），长文通读用',
    component: ImmersiveDetailView,
  },
  {
    carrier: 'floating',
    label: '浮层小窗',
    icon: 'move',
    mode: 'overlay',
    description: '可拖动的小窗，不拦列表点击；对照着改几处时用',
    component: FloatingDetailView,
  },
]

for (const def of BUILT_IN_CARRIERS) registerCarrier(def)
