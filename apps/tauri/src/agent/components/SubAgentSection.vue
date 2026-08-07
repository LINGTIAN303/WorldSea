<script setup lang="ts">
/** SubAgentSection：子 Agent 委派过程展示（running/completed/error 三态），详细见 docs/details/注释/tauri/SubAgentSection.md */
import { ref, computed } from 'vue'
import { useAgentRust, type SubAgentState } from '../composables/useAgentRust'
import TuiIcon from '../../components/ui/TuiIcon.vue'
import RunningDuration from './RunningDuration.vue'

const backend = useAgentRust()
// 解构出顶层 ref：模板中 `backend.xxx` 是嵌套 ref 不会被解包，
// v-for / length 会误遍历 Ref 内部属性（幽灵条目）或得到 undefined
const { subAgents } = backend

// ── 折叠状态：委派记录多时收起列表，仅保留状态栏 ──
const collapsed = ref(false)

// ── 分组统计（顶部状态栏） ──
const runningCount = computed(() => subAgents.value.filter((s: SubAgentState) => s.status === 'running').length)
const completedCount = computed(() => subAgents.value.filter((s: SubAgentState) => s.status === 'completed').length)
const errorCount = computed(() => subAgents.value.filter((s: SubAgentState) => s.status === 'error').length)

// ── 长错误信息展开/收起状态（按委派 id 记录） ──
const expanded = ref<Record<string, boolean>>({})
function toggleExpanded(id: string): void {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}

// ── 格式化辅助 ──
function statusLabel(status: string): string {
  if (status === 'running') return '运行中'
  if (status === 'completed') return '已完成'
  return '失败'
}

function durationLabel(ms?: number): string {
  if (typeof ms !== 'number') return '--'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

/** 是否展示展开按钮（文本超长时） */
function isLong(text: string, threshold = 120): boolean {
  return text.length > threshold
}
</script>

<template>
  <!-- 无委派记录时不渲染整块，避免空会话占用底部空间 -->
  <div v-if="subAgents.length > 0" class="subagent-section">
    <!-- 顶部状态栏 -->
    <div class="bar">
      <span class="bar-title">
        <TuiIcon name="subagent" :size="13" />
        子 Agent 委派
      </span>
      <span v-if="runningCount" class="chip running">
        <span class="chip-dot" />运行中 {{ runningCount }}
      </span>
      <span v-if="completedCount" class="chip completed">完成 {{ completedCount }}</span>
      <span v-if="errorCount" class="chip error">失败 {{ errorCount }}</span>
      <button
        class="collapse"
        :title="collapsed ? '展开委派记录' : '收起委派记录'"
        :aria-label="collapsed ? '展开委派记录' : '收起委派记录'"
        :aria-expanded="!collapsed"
        @click="collapsed = !collapsed"
      >
        <TuiIcon :name="collapsed ? 'chevronRight' : 'chevronDown'" :size="14" />
      </button>
    </div>

    <Transition name="subagent">
      <ul v-show="!collapsed" class="subagent-list">
      <li
        v-for="s in subAgents"
        :key="s.id"
        class="entry"
        :class="s.status"
      >
        <!-- 状态指示 -->
        <span class="status-dot" :title="s.status" />

        <div class="body">
          <div class="head">
            <span class="name">{{ s.subAgentName }}</span>
            <span class="tag">{{ statusLabel(s.status) }}</span>
          </div>
          <div class="task">{{ s.taskDescription }}</div>

          <!-- running：实时运行耗时（独立组件每秒刷新，不牵连父列表重渲染） -->
          <div v-if="s.status === 'running'" class="meta live">
            <RunningDuration :started-at="s.startedAt" />
          </div>

          <!-- completed：输出统计 -->
          <div v-else-if="s.status === 'completed'" class="meta">
            <span>输出 {{ s.outputChars }} 字符</span>
            <span>耗时 {{ durationLabel(s.durationMs) }}</span>
          </div>

          <!-- error：错误信息（过长可展开） -->
          <div v-else-if="s.status === 'error'" class="error-text">
            <span
              :id="`sa-err-${s.id}`"
              :class="{ clamped: !expanded[s.id] && isLong(s.error || '') }"
            >{{ s.error }}</span>
            <button
              v-if="isLong(s.error || '')"
              class="toggle"
              :aria-expanded="!!expanded[s.id]"
              :aria-controls="`sa-err-${s.id}`"
              @click="toggleExpanded(s.id)"
            >
              {{ expanded[s.id] ? '收起' : '展开' }}
            </button>
          </div>
        </div>
      </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.subagent-section {
  max-width: var(--chat-max-w);
  margin: 0 auto;
  border-top: 1px solid var(--border);
  padding: 10px var(--chat-gutter);
  max-height: 220px;
  overflow-y: auto;
  background: var(--bg-surface);
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: var(--fs-sm);
}
.collapse {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.collapse:hover {
  color: var(--text-primary);
  background: var(--bg-muted);
}
/* 按压反馈（批次89） */
.collapse:active {
  transform: scale(var(--press-scale));
}
.bar-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--text-primary);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  font-size: var(--fs-xs);
}
.chip-dot {
  width: var(--dot-sm);
  height: var(--dot-sm);
  border-radius: 50%;
  background: var(--accent);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
}
.chip.running {
  background: var(--accent-soft);
  color: var(--accent);
}
.chip.completed {
  background: var(--success-soft);
  color: var(--success);
}
.chip.error {
  background: var(--danger-soft);
  color: var(--danger);
}
.subagent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* 折叠过渡：展开淡入下滑、收起淡出上移（与 PhaseSection 折叠同一运动语言） */
.subagent-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.subagent-leave-active {
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);
}
.subagent-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.subagent-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.entry {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  transition: border-color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.entry:hover {
  border-color: var(--accent);
}
.entry.running {
  border-color: var(--accent-soft-border);
  background: var(--accent-soft);
}
.entry.running:hover {
  border-color: var(--accent-soft-border);
}
.entry.error {
  border-color: var(--danger-soft);
}
.status-dot {
  width: var(--dot-md);
  height: var(--dot-md);
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}
.entry.running .status-dot {
  background: var(--accent);
  animation: pulse var(--dur-pulse) ease-in-out infinite;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.entry.completed .status-dot {
  background: var(--success);
}
.entry.error .status-dot {
  background: var(--danger);
}
.body {
  flex: 1;
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-primary);
}
.tag {
  font-size: var(--fs-xs);
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-muted);
  color: var(--text-secondary);
}
.entry.running .tag {
  background: var(--accent-soft);
  color: var(--accent);
}
.entry.completed .tag {
  background: var(--success-soft);
  color: var(--success);
}
.entry.error .tag {
  background: var(--danger-soft);
  color: var(--danger);
}
.task {
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  margin-top: 2px;
  word-break: break-word;
}
.meta {
  display: flex;
  gap: 12px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin-top: 4px;
}
.meta.live {
  color: var(--accent);
}
.error-text {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--danger);
  margin-top: 4px;
  word-break: break-word;
}
.error-text .clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.toggle {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--danger);
  font-size: var(--fs-xs);
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}
</style>