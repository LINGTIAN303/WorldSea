<template>
  <!-- 展示型：工具行 + 内嵌 Block 组件 -->
  <div class="itc-display" :class="tc.status">
    <div class="itc-display-header" role="button" tabindex="0" :aria-expanded="isExpanded" @click="toggleExpand" @keydown.enter.prevent="toggleExpand" @keydown.space.prevent="toggleExpand">
      <span class="itc-display-dot" :class="tc.status"></span>
      <span class="itc-display-name">{{ getToolLabel(tc.name) }}</span>
      <span v-if="tc.status === 'running'" class="itc-display-status running">生成中</span>
      <span v-else-if="tc.status === 'completed'" class="itc-display-status completed">完成</span>
      <span v-else class="itc-display-status failed">失败</span>
      <span v-if="blockSummary" class="itc-display-summary">{{ blockSummary }}</span>
      <WsIcon name="chevron-right" size="xs" class="itc-display-chevron" :class="{ expanded: isExpanded }" />
    </div>
    <Transition name="itc-block-expand">
      <div v-if="isExpanded && block && tc.status === 'completed'" class="itc-display-block" @click.stop>
        <BlockTable v-if="block.type === 'table'" :block="block" @action="emit('block-action', $event)" />
        <BlockChoice v-else-if="block.type === 'choice'" :block="block" @action="emit('block-action', $event)" />
        <BlockCode v-else-if="block.type === 'code'" :block="block" @action="emit('block-action', $event)" />
        <BlockEntityCard v-else-if="block.type === 'entity-card'" :block="block" @action="emit('block-action', $event)" />
        <BlockAlert v-else-if="block.type === 'alert'" :block="block" @action="emit('block-action', $event)" />
        <BlockStat v-else-if="block.type === 'stat'" :block="block" @action="emit('block-action', $event)" />
        <BlockList v-else-if="block.type === 'list'" :block="block" @action="emit('block-action', $event)" />
        <BlockProgress v-else-if="block.type === 'progress'" :block="block" @action="emit('block-action', $event)" />
        <BlockComparison v-else-if="block.type === 'comparison'" :block="block" @action="emit('block-action', $event)" />
        <BlockTimeline v-else-if="block.type === 'timeline'" :block="block" @action="emit('block-action', $event)" />
        <BlockImage v-else-if="block.type === 'image'" :block="block" @action="emit('block-action', $event)" />
        <BlockAccordion v-else-if="block.type === 'accordion'" :block="block" @action="emit('block-action', $event)" />
        <BlockManuscript v-else-if="block.type === 'manuscript'" :block="block" @action="emit('block-action', $event)" />
        <div v-else class="itc-display-unknown">
          <pre>{{ formatJson(block) }}</pre>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BlockTable from '../BlockTable.vue'
import BlockChoice from '../BlockChoice.vue'
import BlockCode from '../BlockCode.vue'
import BlockEntityCard from '../BlockEntityCard.vue'
import BlockAlert from '../BlockAlert.vue'
import BlockStat from '../BlockStat.vue'
import BlockList from '../BlockList.vue'
import BlockProgress from '../BlockProgress.vue'
import BlockComparison from '../BlockComparison.vue'
import BlockTimeline from '../BlockTimeline.vue'
import BlockImage from '../BlockImage.vue'
import BlockAccordion from '../BlockAccordion.vue'
import BlockManuscript from '../BlockManuscript.vue'
import type { ToolCallView } from '@worldsmith/shared-composables/agent/useAgent'
import type { BlockActionEvent } from '../index'
import { getBlockSummary } from '../index'
import { getToolLabel, formatJson } from './utils'

const props = defineProps<{
  tc: ToolCallView
}>()

const emit = defineEmits<{
  'block-action': [event: BlockActionEvent]
}>()

/** 展示型 Block 数据（output_* 工具执行后回填） */
const block = computed(() => props.tc.block)

/** 折叠状态：completed 时默认展开 */
const isExpanded = ref(props.tc.status === 'completed')

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

/** 展示型 Block 摘要（折叠状态预览） */
const blockSummary = computed(() => {
  if (!block.value) return ''
  return getBlockSummary(block.value)
})
</script>

<style scoped>
/* ─── 展示型：工具行 + 内嵌 Block ─── */
.itc-display {
  border-radius: 8px;
  border: 1px solid var(--agent-border);
  background: color-mix(in srgb, var(--bg-surface) 2%, transparent);
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
}

.itc-display:hover {
  border-color: var(--border-strong);
}

.itc-display-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}

.itc-display-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--agent-text-tertiary);
}

.itc-display-dot.running {
  background: var(--agent-segment-tooling, #38bdf8);
  animation: itc-pulse 1.5s infinite;
}

.itc-display-dot.completed {
  background: var(--agent-segment-output, #34d399);
}

.itc-display-dot.failed {
  background: var(--agent-danger, #ef4444);
}

.itc-display-name {
  font-weight: 600;
  color: var(--agent-text);
  flex-shrink: 0;
}

.itc-display-status {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.itc-display-status.running {
  background: color-mix(in srgb, var(--agent-segment-tooling, #38bdf8) 10%, transparent);
  color: var(--agent-segment-tooling, #38bdf8);
}

.itc-display-status.completed {
  background: color-mix(in srgb, var(--agent-segment-output, #34d399) 8%, transparent);
  color: color-mix(in srgb, var(--agent-segment-output, #34d399) 70%, transparent);
}

.itc-display-status.failed {
  background: color-mix(in srgb, var(--agent-danger, #ef4444) 8%, transparent);
  color: color-mix(in srgb, var(--agent-danger, #ef4444) 70%, transparent);
}

.itc-display-summary {
  font-size: 11px;
  color: var(--agent-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.itc-display-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.itc-display-chevron.expanded {
  transform: rotate(90deg);
}

.itc-display-block {
  border-top: 1px solid var(--agent-border);
  padding: 8px 10px;
}

.itc-display-unknown {
  font-size: 11px;
  color: var(--agent-text-tertiary);
  padding: 4px;
}

.itc-display-unknown pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ─── 展示型动画 ─── */
@keyframes itc-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.itc-block-expand-enter-active,
.itc-block-expand-leave-active {
  transition: max-height 0.25s ease, opacity 0.2s ease;
  max-height: 600px;
  overflow: hidden;
}

.itc-block-expand-enter-from,
.itc-block-expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
