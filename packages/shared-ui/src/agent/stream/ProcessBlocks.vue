<!--
  ProcessBlocks：过程层多级折叠树块的递归渲染（2026-09-04 待办项升级）
  块类型（aggregatePlanBlocks 产出）：
    combination（组合行段 · 二级小折叠条）：兜连续非文本行段（think/tool），点击头折叠/展开
    plan_zone（计划折叠区 · 区级折叠头）：与过程层总折叠条同级但职责=待办项；折叠态在数据层
              （turn.planCollapsed，跨切窗持久），点击头 → 上抛 plan-zone-toggle
    plan_item（待办项 · 文字折叠条）：pending 无子动作时隐藏（串行时序）；折叠态在数据层
              （item.stepCollapsed，运行中完成自动折叠）；点击头 → 上抛 plan-step-toggle
    普通行 → StreamRow 直出
  折叠头统一复用 .ws-process-summary 文字折叠条配方（chevron + 文字 + hover 淡出），
  不用 button 行条（用户拍板：计划步骤条从行条升级为与总折叠条同级）。
-->
<template>
  <template v-for="block in visibleBlocks" :key="blockKey(block)">
    <!-- 组合行段（二级小折叠条）：连续非文本行段 -->
    <div v-if="isCombinationBlock(block)" class="ws-combination">
      <div class="ws-combination-head" role="button" tabindex="0" @click="toggleCombo(block)" @keydown.enter="toggleCombo(block)">
        <WsIcon :name="comboCollapsed.has(combKey(block)) ? 'chevron-right' : 'chevron-down'" size="xs" class="ws-combo-chevron" />
        <span class="ws-combo-text">{{ block.rows.length }} 段执行</span>
      </div>
      <div v-show="!comboCollapsed.has(combKey(block))" class="ws-combination-body">
        <StreamRow
          v-for="row in block.rows"
          :key="row.id"
          :item="row"
          :animated="animatedIds.has(row.id)"
          :is-hovered="hoveredId === row.id"
          @hover="emit('hover', $event)"
          @leave="emit('leave')"
          @copy="(m) => emit('copy', m)"
          @block-action="(e) => emit('block-action', e)"
          @manuscript-local-action="(e) => emit('manuscript-local-action', e)"
          @tool-confirm="(e) => emit('tool-confirm', e)"
          @expand="() => emit('segment-expand', turnId)"
        />
      </div>
    </div>

    <!-- 计划步骤折叠区（区级折叠头） -->
    <div v-else-if="isPlanZoneBlock(block)" class="ws-plan-zone">
      <div
        class="ws-plan-zone-head"
        role="button"
        tabindex="0"
        :aria-expanded="!zoneCollapsed"
        @click="emit('plan-zone-toggle', turnId)"
        @keydown.enter="emit('plan-zone-toggle', turnId)"
      >
        <WsIcon :name="zoneCollapsed ? 'chevron-right' : 'chevron-down'" size="xs" class="ws-zone-chevron" />
        <span class="ws-zone-text">{{ planItemCount(block) }} 待办</span>
      </div>
      <div v-show="!zoneCollapsed" class="ws-plan-zone-body">
        <ProcessBlocks
          :blocks="block.items"
          :turn-id="turnId"
          :combo-collapsed="comboCollapsed"
          :zone-collapsed-map="zoneCollapsedMap"
          :animated-ids="animatedIds"
          :hovered-id="hoveredId"
          @combo-toggle="emit('combo-toggle', $event)"
          @plan-zone-toggle="emit('plan-zone-toggle', $event)"
          @plan-step-toggle="emit('plan-step-toggle', $event)"
          @hover="emit('hover', $event)"
          @leave="emit('leave')"
          @copy="emit('copy', $event)"
          @block-action="emit('block-action', $event)"
          @manuscript-local-action="emit('manuscript-local-action', $event)"
          @tool-confirm="emit('tool-confirm', $event)"
          @segment-expand="emit('segment-expand', $event)"
          @expand="emit('expand', $event)"
        />
      </div>
    </div>

    <!-- 待办项（项级文字折叠条）；pending 且无子动作 → 串行时序隐藏（visibleBlocks 已过滤） -->
    <div v-else-if="isPlanItemBlock(block)" class="ws-plan-item">
      <div
        class="ws-plan-item-head"
        role="button"
        tabindex="0"
        :aria-expanded="!stepCollapsed(block)"
        @click="emit('plan-step-toggle', { turnId, stepId: block.item.id })"
        @keydown.enter="emit('plan-step-toggle', { turnId, stepId: block.item.id })"
      >
        <WsIcon :name="stepCollapsed(block) ? 'chevron-right' : 'chevron-down'" size="xs" class="ws-item-chevron" />
        <span class="ws-plan-item-order">待办项 {{ orderOf(block) }}</span>
        <span class="ws-plan-item-title" :class="{ 'ws-shine-text': isRunning(block) }">{{ block.item.tc.name }}</span>
        <span v-if="isRunning(block)" class="ws-plan-item-status running">执行中</span>
        <span v-else-if="planStatusOf(block) === 'completed'" class="ws-plan-item-status done">已完成</span>
        <span v-else-if="planStatusOf(block) === 'failed'" class="ws-plan-item-status fail">失败</span>
        <span v-else-if="planStatusOf(block) === 'skipped'" class="ws-plan-item-status skip">已跳过</span>
        <span v-else class="ws-plan-item-status pending">待执行</span>
      </div>
      <div v-show="!stepCollapsed(block)" class="ws-plan-item-body">
        <ProcessBlocks
          :blocks="block.rows"
          :turn-id="turnId"
          :combo-collapsed="comboCollapsed"
          :zone-collapsed-map="zoneCollapsedMap"
          :animated-ids="animatedIds"
          :hovered-id="hoveredId"
          @combo-toggle="emit('combo-toggle', $event)"
          @plan-zone-toggle="emit('plan-zone-toggle', $event)"
          @plan-step-toggle="emit('plan-step-toggle', $event)"
          @hover="emit('hover', $event)"
          @leave="emit('leave')"
          @copy="emit('copy', $event)"
          @block-action="emit('block-action', $event)"
          @manuscript-local-action="emit('manuscript-local-action', $event)"
          @tool-confirm="emit('tool-confirm', $event)"
          @segment-expand="emit('segment-expand', $event)"
          @expand="emit('expand', $event)"
        />
        <!-- 待办项产出区：description 说明 + result/output + reason -->
        <div v-if="outputText(block) || block.item.planReason" class="ws-plan-item-output">
          <div v-if="block.item.planDescription" class="ws-plan-item-output-desc">{{ block.item.planDescription }}</div>
          <div v-if="outputText(block) && outputText(block) !== block.item.planDescription" class="ws-plan-item-output-result">
            <span class="ws-plan-item-output-label">产出</span>
            <pre class="ws-plan-item-output-code">{{ outputText(block) }}</pre>
          </div>
          <div v-if="block.item.planReason" class="ws-plan-item-output-reason">原因：{{ block.item.planReason }}</div>
        </div>
      </div>
    </div>

    <!-- 普通行段 -->
    <StreamRow
      v-else
      :key="block.id"
      :item="block"
      :animated="animatedIds.has(block.id)"
      :is-hovered="hoveredId === block.id"
      @hover="emit('hover', $event)"
      @leave="emit('leave')"
      @copy="emit('copy', $event)"
      @block-action="emit('block-action', $event)"
      @manuscript-local-action="emit('manuscript-local-action', $event)"
      @tool-confirm="emit('tool-confirm', $event)"
      @expand="() => emit('segment-expand', turnId)"
      @expand-process="() => emit('expand', turnId)"
    />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { AgentStreamItem } from '@worldsmith/shared-composables/agent/useAgent'
import type { ProcessBlock, CombinationBlock, PlanItemBlock, PlanZoneBlock } from './aggregatePlanBlocks'
import StreamRow from './rows/StreamRow.vue'
import type { AgentMessage, BlockActionEvent } from '../bubbles/types'

const props = defineProps<{
  blocks: ProcessBlock[]
  /** 所属轮次 id（折叠 toggle 上抛用） */
  turnId: string
  /** 组合行段本地折叠态（组件内 ref 由 AgentStreamList 持有，切窗重挂重置为展开） */
  comboCollapsed: Set<string>
  /** 区级折叠态（turnId → planCollapsed，数据层持久，跨切窗保留） */
  zoneCollapsedMap: Record<string, boolean>
  animatedIds: Set<string>
  hoveredId: string | null
}>()

const emit = defineEmits<{
  (e: 'combo-toggle', id: string): void
  (e: 'plan-zone-toggle', turnId: string): void
  (e: 'plan-step-toggle', payload: { turnId: string; stepId: string }): void
  (e: 'hover', id: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'block-action', event: BlockActionEvent): void
  (e: 'manuscript-local-action', event: BlockActionEvent): void
  (e: 'tool-confirm', event: { toolId: string; approved: boolean }): void
  (e: 'segment-expand', turnId: string): void
  (e: 'expand', turnId: string): void
}>()

/** 块稳定 key（窗口化渲染 key；组合/区为合成 DOM，前缀防与行 id 冲突） */
function blockKey(block: ProcessBlock): string {
  const kind = (block as { kind?: string }).kind
  if (kind === 'combination') return `comb-${(block as CombinationBlock).col.id}`
  if (kind === 'plan_zone') return `zone-${((block as PlanZoneBlock).items[0] as { id?: string })?.id ?? 'x'}`
  if (kind === 'plan_item') return (block as PlanItemBlock).item.id
  return (block as AgentStreamItem).id
}
function combKey(block: CombinationBlock): string {
  return `comb-${block.col.id}`
}

/** 类型守卫（vue-tsc 模板判别链收窄）：三类合成块 vs 普通行 */
function isCombinationBlock(b: ProcessBlock): b is CombinationBlock {
  return (b as { kind?: string }).kind === 'combination'
}
function isPlanZoneBlock(b: ProcessBlock): b is PlanZoneBlock {
  return (b as { kind?: string }).kind === 'plan_zone'
}
function isPlanItemBlock(b: ProcessBlock): b is PlanItemBlock {
  return (b as { kind?: string }).kind === 'plan_item'
}

/** 串行时序过滤：pending 且无子动作 → 该待办项 UI 不出现（动作行段永不先于其待办项头出现） */
function hiddenBySerial(block: PlanItemBlock): boolean {
  return planStatusOf(block) === 'pending' && (block.item.childRefIds ?? []).length === 0
}
const visibleBlocks = computed<ProcessBlock[]>(() =>
  props.blocks.filter((b) => !(isPlanItemBlock(b) && hiddenBySerial(b))),
)

function toggleCombo(block: CombinationBlock): void {
  emit('combo-toggle', combKey(block))
}

/** 区级折叠态：数据层 planCollapsed（默认 false 展开） */
const zoneCollapsed = computed(() => props.zoneCollapsedMap[props.turnId] === true)

/** 区内可见待办数（区级折叠头文案；串行时序下未露头的 pending 项不计入） */
function planItemCount(zone: PlanZoneBlock): number {
  return zone.items.filter((b) => isPlanItemBlock(b) && !hiddenBySerial(b)).length
}

function stepCollapsed(block: PlanItemBlock): boolean {
  return block.item.stepCollapsed === true
}
function isRunning(block: PlanItemBlock): boolean {
  return planStatusOf(block) === 'running'
}
function planStatusOf(block: PlanItemBlock): string {
  return block.item.planStatus ?? 'pending'
}
function orderOf(block: PlanItemBlock): number {
  return (block.item.planOrder ?? 0) + 1
}

/** 产出主文本：工具结果（tc.result 或 item.result 归一） */
function outputText(block: PlanItemBlock): string {
  const r = block.item.tc.result ?? (block.item as { result?: unknown }).result
  return typeof r === 'string' ? r : r !== undefined && r !== null ? String(r) : ''
}
</script>