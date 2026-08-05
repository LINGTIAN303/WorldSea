<script setup lang="ts">
/**
 * # SubAgentSection — 子 Agent 委派过程展示
 *
 * 订阅 `useAgentRust().subAgents`（由 Rust `agent:event:subagent:{session_id}`
 * 事件驱动维护），实时展示主 Agent 委派给子 Agent 的任务状态：
 * - `running`：委派执行中（蓝色旋转指示）
 * - `completed`：委派完成（绿色，展示输出字符数与耗时）
 * - `error`：委派失败 / 超时（红色，展示错误信息）
 *
 * 仅做展示，不发起任何调用；状态由模块级单例 `useAgentRust` 统一维护。
 */
import { useAgentRust } from '../composables/useAgentRust'

const backend = useAgentRust()
</script>

<template>
  <div class="subagent-section">
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

          <!-- completed：展示输出统计 -->
          <div v-if="s.status === 'completed'" class="meta">
            <span>输出 {{ s.outputChars }} 字符</span>
            <span>耗时 {{ durationLabel(s.durationMs) }}</span>
          </div>

          <!-- error：展示错误信息 -->
          <div v-else-if="s.status === 'error'" class="error-text">{{ s.error }}</div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
// 纯函数辅助（放在普通 script 块，避免与 setup 混写）
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
</script>

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
.error-text {
  font-size: 11px;
  color: #d93025;
  margin-top: 4px;
  word-break: break-word;
}
</style>