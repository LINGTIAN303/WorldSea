<script setup lang="ts">
/** SubAgentSection：子 Agent 委派过程展示（running/completed/error 三态），详细见 docs/details/注释/tauri/SubAgentSection.md */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useAgentRust, type SubAgentState } from '../composables/useAgentRust'

const backend = useAgentRust()

// ── 运行耗时实时刷新：每秒触发一次重渲染，驱动 running 条目耗时跳动 ──
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

// ── 分组统计（顶部状态栏） ──
const runningCount = computed(() => backend.subAgents.value.filter((s: SubAgentState) => s.status === 'running').length)
const completedCount = computed(() => backend.subAgents.value.filter((s: SubAgentState) => s.status === 'completed').length)
const errorCount = computed(() => backend.subAgents.value.filter((s: SubAgentState) => s.status === 'error').length)

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

/** 运行耗时（相对某时刻至今的实时值） */
function elapsedLabel(startedAt: number): string {
  const ms = Math.max(0, now.value - startedAt)
  if (ms < 1000) return '刚刚开始'
  if (ms < 60000) return `已运行 ${Math.floor(ms / 1000)} 秒`
  const s = Math.floor(ms / 1000)
  return `已运行 ${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

/** 是否展示展开按钮（文本超长时） */
function isLong(text: string, threshold = 120): boolean {
  return text.length > threshold
}
</script>

<template>
  <div class="subagent-section">
    <!-- 顶部状态栏：无委派时不展示 -->
    <div v-if="backend.subAgents.length > 0" class="bar">
      <span class="bar-title">子 Agent 委派</span>
      <span v-if="runningCount" class="chip running">运行中 {{ runningCount }}</span>
      <span v-if="completedCount" class="chip completed">完成 {{ completedCount }}</span>
      <span v-if="errorCount" class="chip error">失败 {{ errorCount }}</span>
    </div>

    <div v-if="backend.subAgents.length === 0" class="empty">
      暂未发生子 Agent 委派
    </div>

    <ul v-else class="subagent-list">
      <li
        v-for="s in backend.subAgents"
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

          <!-- running：实时运行耗时 -->
          <div v-if="s.status === 'running'" class="meta live">
            <span>{{ elapsedLabel(s.startedAt) }}</span>
          </div>

          <!-- completed：输出统计 -->
          <div v-else-if="s.status === 'completed'" class="meta">
            <span>输出 {{ s.outputChars }} 字符</span>
            <span>耗时 {{ durationLabel(s.durationMs) }}</span>
          </div>

          <!-- error：错误信息（过长可展开） -->
          <div v-else-if="s.status === 'error'" class="error-text">
            <span :class="{ clamped: !expanded[s.id] && isLong(s.error || '') }">{{ s.error }}</span>
            <button
              v-if="isLong(s.error || '')"
              class="toggle"
              @click="toggleExpanded(s.id)"
            >
              {{ expanded[s.id] ? '收起' : '展开' }}
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.subagent-section {
  border-top: 1px solid #eee;
  padding: 10px 20px;
  max-height: 220px;
  overflow-y: auto;
  background: #fcfcfc;
}
.empty {
  color: #999;
  font-size: 12px;
  text-align: center;
  padding: 8px 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
}
.bar-title {
  font-weight: 600;
  color: #444;
}
.chip {
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
}
.chip.running {
  background: #e8f0fe;
  color: #1a73e8;
}
.chip.completed {
  background: #e6f4ea;
  color: #188038;
}
.chip.error {
  background: #fce8e6;
  color: #d93025;
}
.subagent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.entry {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-top: 5px;
  flex-shrink: 0;
}
.entry.running .status-dot {
  background: #1a73e8;
  animation: pulse 1.2s infinite;
}
.entry.completed .status-dot {
  background: #188038;
}
.entry.error .status-dot {
  background: #d93025;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
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
  font-size: 13px;
  font-weight: 600;
  color: #333;
}
.tag {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  background: #f0f0f0;
  color: #666;
}
.entry.running .tag {
  background: #e8f0fe;
  color: #1a73e8;
}
.entry.completed .tag {
  background: #e6f4ea;
  color: #188038;
}
.entry.error .tag {
  background: #fce8e6;
  color: #d93025;
}
.task {
  font-size: 12px;
  color: #555;
  margin-top: 2px;
  word-break: break-word;
}
.meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #999;
  margin-top: 4px;
}
.meta.live {
  color: #1a73e8;
}
.error-text {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
  color: #d93025;
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
  color: #d93025;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}
</style>