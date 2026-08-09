<template>
  <!-- 深度模式：渲染虚拟段落（过程段大折叠 + 选择型工具 + 最终结论区） -->
  <template v-if="deepSegments.length > 0">
    <!-- 过程段大折叠容器 -->
    <div class="process-collapse" :class="{ collapsed: !isProcessExpanded }">
      <div class="process-collapse-header" role="button" tabindex="0" :aria-expanded="isProcessExpanded" @click="isProcessExpanded = !isProcessExpanded" @keydown.enter.prevent="isProcessExpanded = !isProcessExpanded" @keydown.space.prevent="isProcessExpanded = !isProcessExpanded">
        <span class="process-collapse-icon"><WsIcon name="brain" size="s" /></span>
        <span class="process-collapse-title">思考过程</span>
        <span class="process-collapse-stats">{{ processStats }}</span>
        <span class="process-collapse-chevron" :class="{ expanded: isProcessExpanded }">▸</span>
      </div>
      <Transition name="process-expand">
        <div v-if="isProcessExpanded" class="process-collapse-body">
          <DeepSegmentCard
            v-for="seg in deepSegments"
            :key="seg.id"
            :segment="seg as DeepSegment"
            @block-action="emit('block-action', $event)"
            @tool-confirm="emit('tool-confirm', $event)"
          />
        </div>
      </Transition>
    </div>
    <!-- 选择型工具：独立于折叠容器，始终可见 -->
    <div v-if="choiceToolCalls.length > 0" class="choice-float-area">
      <InteractiveToolCall
        v-for="tc in choiceToolCalls"
        :key="tc.id"
        :tc="tc"
        @block-action="emit('block-action', $event)"
        @tool-confirm="emit('tool-confirm', $event)"
      />
    </div>
    <!-- 最终结论区 -->
    <div v-if="finalOutput" class="final-output-card" :class="finalOutput.status">
      <div class="final-output-header">
        <span class="final-output-icon"><WsIcon name="message-text" size="s" /></span>
        <span class="final-output-title">结论</span>
        <span v-if="finalOutput.status === 'streaming'" class="final-output-badge">生成中</span>
      </div>
      <div class="final-output-body" v-html="renderedFinalOutput"></div>
      <!-- 结论区 Block 渲染（选择型/展示型） -->
      <div v-if="finalOutputBlocks.length > 0" class="final-output-blocks">
        <BlockTable v-for="b in tableBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockChoice v-for="b in choiceBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockCode v-for="b in codeBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockEntityCard v-for="b in entityCardBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockAlert v-for="b in alertBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockStat v-for="b in statBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockList v-for="b in listBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockProgress v-for="b in progressBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockComparison v-for="b in comparisonBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockTimeline v-for="b in timelineBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockImage v-for="b in imageBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockAccordion v-for="b in accordionBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" />
        <BlockManuscript v-for="b in manuscriptBlocks" :key="b.id" :block="b" @action="emit('block-action', $event)" @manuscript-local-action="emit('manuscript-local-action', $event)" />
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import DeepSegmentCard from '../blocks/DeepSegmentCard.vue'
import InteractiveToolCall from '../blocks/InteractiveToolCall.vue'
import BlockTable from '../blocks/BlockTable.vue'
import BlockChoice from '../blocks/BlockChoice.vue'
import BlockCode from '../blocks/BlockCode.vue'
import BlockEntityCard from '../blocks/BlockEntityCard.vue'
import BlockAlert from '../blocks/BlockAlert.vue'
import BlockStat from '../blocks/BlockStat.vue'
import BlockList from '../blocks/BlockList.vue'
import BlockProgress from '../blocks/BlockProgress.vue'
import BlockComparison from '../blocks/BlockComparison.vue'
import BlockTimeline from '../blocks/BlockTimeline.vue'
import BlockImage from '../blocks/BlockImage.vue'
import BlockAccordion from '../blocks/BlockAccordion.vue'
import BlockManuscript from '../blocks/BlockManuscript.vue'
import { renderFinalOutput } from './utils'
import type { DeepSegment, FinalOutput, ToolCallView } from '@worldsmith/shared-composables/agent/useAgent'
import type { AgentMessage, MessageBlock } from '@worldsmith/agent-runtime'

const props = defineProps<{
  /** 深度模式段（thinking | phase），来自 useAgent().deepSegments 为 readonly */
  deepSegments: readonly DeepSegment[]
  /** 最终结论区数据（null 表示无结论），来自 useAgent().finalOutput 为 readonly */
  finalOutput: Readonly<FinalOutput> | null
  /** 结论区 Block 列表（从最后一条助手消息 blocks 提取） */
  finalOutputBlocks: MessageBlock[]
  /** 选择型工具列表（独立于折叠容器渲染） */
  choiceToolCalls: ToolCallView[]
  /** Agent 是否在流式输出（用于自动展开/收缩过程段） */
  agentIsStreaming: boolean
  /** 是否处于深度模式（用于 choiceBlocks 的去重逻辑） */
  isDeepMode: boolean
  /** 完整消息列表（保留以兼容未来扩展，当前未使用） */
  messages: AgentMessage[]
}>()

const emit = defineEmits<{
  'block-action': [event: { blockId: string; action: string; data?: Record<string, unknown> }]
  'tool-confirm': [event: { toolId: string; approved: boolean }]
  'manuscript-local-action': [event: { blockId: string; action: string; data?: Record<string, unknown> }]
}>()

/** 过程段大折叠容器：Agent 执行中展开，完成后自动收缩 */
const isProcessExpanded = ref(true)

/** 过程段统计信息（推理次数 + 阶段数） */
const processStats = computed(() => {
  const segs = props.deepSegments
  const thinkingCount = segs.filter(s => s.type === 'thinking').length
  const phaseCount = segs.filter(s => s.type === 'phase').length
  const parts: string[] = []
  if (thinkingCount > 0) parts.push(`${thinkingCount} 次推理`)
  if (phaseCount > 0) parts.push(`${phaseCount} 个阶段`)
  return parts.length > 0 ? parts.join(' · ') : ''
})

/** 渲染最终结论区文本（简易 markdown） */
const renderedFinalOutput = computed(() => renderFinalOutput(props.finalOutput?.content || ''))

/** 检查所有段是否都已完成（thinking=complete, phase=done） */
function allSegmentsDone(segs: readonly DeepSegment[]): boolean {
  return segs.every(s => {
    if (s.type === 'thinking') return s.status === 'complete'
    if (s.type === 'phase') return s.status === 'done'
    return true
  })
}

/** Agent 完成后自动收缩过程段；开始执行时展开 */
watch(() => props.agentIsStreaming, (streaming) => {
  if (!streaming && props.deepSegments.length > 0) {
    if (allSegmentsDone(props.deepSegments)) {
      isProcessExpanded.value = false
    }
  } else if (streaming) {
    isProcessExpanded.value = true
  }
})

/** 刷新恢复后：如果所有段已完成，自动收缩 */
watch(() => props.deepSegments, (segs) => {
  if (segs.length > 0 && !props.agentIsStreaming) {
    if (allSegmentsDone(segs)) {
      isProcessExpanded.value = false
    }
  }
}, { immediate: true })

// ===== 13 种 Block 按类型过滤 =====
const tableBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'table'))
/** 深度模式下 choice block 由 InteractiveToolCall 独立渲染，不在结论区重复 */
const choiceBlocks = computed(() => {
  if (props.isDeepMode && props.choiceToolCalls.length > 0) return []
  return props.finalOutputBlocks.filter(b => b.type === 'choice')
})
const codeBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'code'))
const entityCardBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'entity-card'))
const alertBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'alert'))
const statBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'stat'))
const listBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'list'))
const progressBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'progress'))
const comparisonBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'comparison'))
const timelineBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'timeline'))
const imageBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'image'))
const accordionBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'accordion'))
const manuscriptBlocks = computed(() => props.finalOutputBlocks.filter(b => b.type === 'manuscript'))
</script>

<style scoped>
/* 过程段大折叠容器 */
.process-collapse {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--agent-warning, #eab308) 10%, transparent);
  background: color-mix(in srgb, var(--agent-warning, #eab308) 2%, transparent);
  overflow: hidden;
  animation: seg-in 0.3s ease-out;
  transition: border-color 0.3s, background 0.3s;
}

.process-collapse.collapsed {
  border-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.process-collapse-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.process-collapse-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.process-collapse-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--agent-warning, #eab308) 10%, transparent);
  color: var(--agent-warning, #eab308);
  transition: background 0.3s, color 0.3s;
}

.collapsed .process-collapse-icon {
  background: rgba(255, 255, 255, 0.06);
  color: var(--agent-text-tertiary);
}

.process-collapse-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
  flex-shrink: 0;
}

.process-collapse-stats {
  font-size: 11px;
  color: var(--agent-text-tertiary);
  flex-shrink: 0;
}

.process-collapse-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.process-collapse-chevron.expanded {
  transform: rotate(90deg);
}

.process-collapse-body {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 过程段展开/收缩动画 */
.process-expand-enter-active,
.process-expand-leave-active {
  transition: max-height 0.3s ease, opacity 0.2s ease;
  max-height: 2000px;
  overflow: hidden;
}

.process-expand-enter-from,
.process-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.final-output-card {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--agent-success, #22c55e) 12%, transparent);
  background: color-mix(in srgb, var(--agent-success, #22c55e) 2%, transparent);
  overflow: hidden;
  animation: seg-in 0.3s ease-out;
}

.final-output-card.streaming {
  border-color: color-mix(in srgb, var(--agent-success, #22c55e) 20%, transparent);
}

.final-output-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.final-output-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--agent-success, #22c55e) 10%, transparent);
  color: #22c55e;
}

.final-output-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-text);
}

.final-output-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--agent-primary) 10%, transparent);
  color: var(--agent-primary);
  animation: badge-pulse 1.5s infinite;
}

.final-output-body {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--agent-text);
}

.final-output-body :deep(code) {
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}

/* 结论区 Block 渲染 */
.final-output-blocks {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 选择型工具独立渲染区（始终可见，不受折叠影响） */
.choice-float-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 4px;
}

@keyframes seg-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes badge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
