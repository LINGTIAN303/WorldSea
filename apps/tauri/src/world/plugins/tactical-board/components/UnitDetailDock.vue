<template>
  <component
    :is="carrierDef.component"
    :visible="!!unit"
    :entity="unit"
    :icon="unit ? (unit.team === 'ally' ? 'ally' : unit.team === 'enemy' ? 'devil' : 'people') : ''"
    :title="unit?.name || ''"
    subtitle="战术棋盘单位"
    :tabs="UNIT_TABS"
    :min-width="240"
    :max-width="460"
    :default-width="300"
    :panel-id="detailPanelId"
    entity-type="tactical-board"
    @close="emit('close')"
  >
    <template #unit>
      <UnitPanel
        :unit="unit"
        :showActions="showActions"
        :showDeployActions="showDeployActions"
        :disabled="disabled"
        @move="emit('move')"
        @attack="emit('attack')"
        @wait="emit('wait')"
        @remove="emit('remove')"
      />
    </template>
  </component>
</template>

<script setup lang="ts">
/**
 * 单位详情 dock：把战术棋盘原来钉在右栏里的 `UnitPanel` 装进可切换的载体。详细见
 * docs/plans/2026-10-02-实体详情表单地基与形态批计划.md §七之十
 *
 * 为什么要多这一层：`TacticalBoardView.vue` 在 arch 冻结线上且**余量为 0**（基线＝当前行数），
 * 直接把 `<component :is>` + 六七个属性写进视图就会点红。把载体这件事收进子件，
 * 视图只换一个标签；优先序、宽度键、mode 判断仍走 `useDetailCarrier` 单点，不在这里重拼。
 */
import { useDetailCarrier } from '@worldsea/plugin-sdk'
import UnitPanel from './UnitPanel.vue'
import type { WasmBattleUnit } from '../composables/useTacticalEngine'
import type { DetailTab } from '@worldsea/plugin-sdk'

/** 单标签＝不显示标签条（载体里 `tabs.length > 1` 才渲），但内容槽名要与 activeTab 对得上 */
const UNIT_TABS: DetailTab[] = [{ id: 'unit', label: '单位' }]

const props = defineProps<{
  unit: WasmBattleUnit | null
  showActions: boolean
  showDeployActions: boolean
  disabled: boolean
  /** 芽声明的缺省载体（本芽历史上是常驻右栏，所以由视图传 `column`，别让接载体变成改观感） */
  detailCarrier?: string
}>()

const emit = defineEmits<{
  close: []
  move: []
  attack: []
  wait: []
  remove: []
}>()

const { carrierDef, detailPanelId } = useDetailCarrier(() => 'tactical-board', () => props.detailCarrier)
</script>
