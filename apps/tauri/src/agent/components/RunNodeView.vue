<script setup lang="ts">
/**
 * RunNodeView：run 树单个节点（递归渲染子节点）
 *
 * 自引用递归（Vue SFC 按文件名引用自身）。节点行可展开详情：
 * 终局结论（超长截断）+ 产出物/决策/收敛原因计数。
 * 状态点/标签颜色由 run.status 驱动（scoped 样式映射）。
 */
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { pipelineLabel, runStatusLabel, type RunTreeNode, type RunRecord } from '../composables/useRunTree'

const props = defineProps<{
  node: RunTreeNode
  /** 深度（0=顶层；>0 子 run，缩进/连线样式） */
  depth: number
  /** 节点详情展开集（按 run_id，父组件持有） */
  expandedMap: Record<string, boolean>
}>()

const emit = defineEmits<{ toggle: [runId: string] }>()

const run = computed<RunRecord>(() => props.node.run)
const isExpanded = computed<boolean>(() => !!props.expandedMap[run.value.run_id])

function toggleNode(): void {
  emit('toggle', run.value.run_id)
}

/** 相对时长（ms → 秒/分）；running 未收口用当前时间 */
function durationText(): string {
  const start = run.value.started_at ?? Date.now()
  const end = run.value.finished_at ?? (run.value.status === 'running' ? Date.now() : start)
  const ms = Math.max(0, end - start)
  if (ms < 1000) return '1s 内'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  return `${Math.floor(sec / 60)}m ${sec % 60 ? `${sec % 60}s` : ''}`
}

function statusClass(status: RunRecord['status']): string {
  return `is-${status}`
}

/** 终局结论超长（>6 行）需截断 */
const FINAL_CLAMP = 6
function isLongFinal(): boolean {
  return (run.value.final_message?.split('\n').length ?? 0) > FINAL_CLAMP
}
</script>

<template>
  <div
    class="node"
    :class="[statusClass(run.status), { 'is-child': depth > 0 }]"
  >
    <button
      type="button"
      class="node-main"
      :aria-expanded="isExpanded"
      :aria-label="`${pipelineLabel(run.pipeline)}，${runStatusLabel(run.status)}`"
      @click="toggleNode"
    >
      <WsIcon
        :name="isExpanded ? 'chevron-down' : 'chevron-right'"
        :size="12"
        :stroke-width="1.7"
        class="node-chevron"
      />
      <span class="node-dot" :class="statusClass(run.status)" aria-hidden="true" />
      <span class="node-pipeline">{{ pipelineLabel(run.pipeline) }}</span>
      <span class="node-tag" :class="statusClass(run.status)">{{ runStatusLabel(run.status) }}</span>
      <span class="node-duration">{{ durationText() }}</span>
    </button>

    <div v-if="isExpanded" class="node-detail">
      <p v-if="run.final_message" class="node-final" :class="{ clamped: isLongFinal() }">
        {{ run.final_message }}
      </p>
      <p v-else class="node-final muted">（无终局结论）</p>
      <span class="node-meta">
        <span>物 {{ run.artifacts?.length ?? 0 }}</span>
        <span>决策 {{ run.decisions?.length ?? 0 }}</span>
        <span v-if="run.converge_reason">收敛 {{ run.converge_reason }}</span>
      </span>
    </div>

    <!-- 子 run（委派）递归渲染 -->
    <ul v-if="node.children.length" class="children" role="group">
      <li v-for="child in node.children" :key="child.run.run_id" role="treeitem">
        <RunNodeView
          :node="child"
          :depth="depth + 1"
          :expanded-map="expandedMap"
          @toggle="emit('toggle', $event)"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.node {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  transition: border-color var(--dur-fast) var(--ease);
}
.node:hover {
  border-color: var(--accent);
}
.node.is-running {
  border-color: var(--accent-soft-border);
}
.node.is-error {
  border-color: var(--danger-soft);
}
.node.is-aborted,
.node.is-timeout,
.node.is-interrupted {
  border-color: var(--warning-soft);
}
.node.is-child .node-main {
  padding-left: 10px;
}
.node-main {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.node-chevron {
  flex-shrink: 0;
  color: var(--text-muted);
}
.node-dot {
  width: var(--dot-md);
  height: var(--dot-md);
  border-radius: 50%;
  flex-shrink: 0;
}
.node-dot.is-running {
  background: var(--accent);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
}
.node-dot.is-completed {
  background: var(--success);
}
.node-dot.is-error {
  background: var(--danger);
}
.node-dot.is-aborted,
.node-dot.is-timeout,
.node-dot.is-interrupted {
  background: var(--warning);
}
.node-pipeline {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-tag {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.node-tag.is-running {
  background: var(--accent-soft);
  color: var(--accent);
}
.node-tag.is-completed {
  background: var(--success-soft);
  color: var(--success);
}
.node-tag.is-error {
  background: var(--danger-soft);
  color: var(--danger);
}
.node-tag.is-aborted,
.node-tag.is-timeout,
.node-tag.is-interrupted {
  background: var(--warning-soft);
  color: var(--warning);
}
.node-duration {
  flex-shrink: 0;
  margin-left: auto;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.node-detail {
  padding: 0 10px 8px 30px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.node-final {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.node-final.muted {
  color: var(--text-muted);
}
.node-final.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.node-meta {
  display: flex;
  gap: 12px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.children {
  list-style: none;
  margin: 4px 0 6px 18px;
  padding: 0 0 0 10px;
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
