import { computed, type ComputedRef } from 'vue'
import { useDetailLayoutStore } from '@worldsea/entity-core'
import { activeCarrier, carrierPanelId, resolveCarrier, type CarrierDefinition } from './carriers'

/**
 * 载体解析的单点。谁在用：`GenericEntityView`、`SchemaRenderer` 下游的时间线、两块自绘详情面
 * （大纲白板/战术棋盘）；抽出理由同「四套字段控件」教训——优先序/宽度键/mode 在四个调用点各拼一遍就是
 * 四条真值路径；选中与否不在这里判，只回答「该用哪个容器」。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md §十二
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
