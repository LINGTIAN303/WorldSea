import { computed, type ComputedRef } from 'vue'
import { useDetailLayoutStore } from '@worldsea/entity-core'
import { activeCarrier, carrierPanelId, resolveCarrier, type CarrierDefinition } from './carriers'

/**
 * 载体解析的单点。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十二
 *
 * 谁在用：`GenericEntityView`、`SchemaRenderer` 下游的时间线，以及两块自绘详情面（大纲白板 / 战术棋盘）。
 * 抽出来的理由和 1a 拆字段控件一样——优先序（覆写 > 芽声明 > 缺省）、宽度键、mode 判断
 * 在四个调用点各拼一遍，就是四条真值路径，改一处漏三处。
 *
 * 「有没有选中实体」不在这个件里判：那是各视图自己的状态，它只回答「该用哪个容器」。
 */
export interface DetailCarrier {
  carrierDef: ComputedRef<CarrierDefinition>
  /** 宽度等实例态按「载体 + 类型」分键 */
  detailPanelId: ComputedRef<string>
  isOverlay: ComputedRef<boolean>
  isSplit: ComputedRef<boolean>
  isImmersive: ComputedRef<boolean>
}

export function useDetailCarrier(
  entityType: () => string,
  declaredCarrier?: () => string | undefined,
): DetailCarrier {
  const prefs = useDetailLayoutStore()
  const carrierDef = computed(() =>
    activeCarrier(resolveCarrier(prefs.carriers[entityType()], declaredCarrier?.())),
  )

  return {
    carrierDef,
    detailPanelId: computed(() => carrierPanelId(carrierDef.value.carrier, entityType())),
    isOverlay: computed(() => carrierDef.value.mode === 'overlay'),
    isSplit: computed(() => carrierDef.value.mode === 'split'),
    isImmersive: computed(() => carrierDef.value.mode === 'immersive'),
  }
}
