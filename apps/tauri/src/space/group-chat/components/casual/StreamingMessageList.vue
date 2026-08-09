<template>
  <template v-for="agentId in activeStreamingIds" :key="`streaming-${agentId}`">
    <div class="streaming-msg">
      <div class="msg-header">
        <div class="msg-avatar" :style="{ background: getSpeakerColor(agentId) }">
          <span class="avatar-letter">{{ getSpeakerName(agentId)[0] || '?' }}</span>
        </div>
        <span class="msg-name" :style="{ color: getSpeakerColor(agentId) }">{{ getSpeakerName(agentId) }}</span>
      </div>
      <div class="msg-content">
        <!-- Layer 1: 流式工具调用状态指示器 -->
        <div v-if="getStreamingToolCalls(agentId).length > 0" class="streaming-tools">
          <span v-for="tc in getStreamingToolCalls(agentId)" :key="tc.id" class="streaming-tool-tag" :class="tc.status">
            <WsIcon v-if="tc.status === 'running'" name="loader" size="xs" class="tc-spin" />
            <WsIcon v-else-if="tc.status === 'completed'" name="check" size="xs" />
            <WsIcon v-else name="x" size="xs" />
            {{ getToolLabel(tc.name) }}
          </span>
        </div>
        <div class="msg-text">
          <div v-html="renderStreamingContent(agentId)"></div>
          <span v-if="!getStreamingToolCalls(agentId).some(tc => tc.status === 'running')" class="streaming-cursor">●</span>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { useStreamingMessages } from '../../composables/useStreamingMessages'
import { getToolLabel } from '../../types'
import { WsIcon } from '@worldsmith/ui-kit'

// 流式消息显示：复用 composable，store 为 pinia 单例
const {
  activeStreamingIds,
  getSpeakerName,
  getSpeakerColor,
  renderStreamingContent,
  getStreamingToolCalls,
} = useStreamingMessages()
</script>

<style scoped>
.streaming-msg { padding: 4px 16px; margin-bottom: 2px; }
.streaming-msg .msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.streaming-msg .msg-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.streaming-msg .avatar-letter { color: white; font-weight: 700; font-size: var(--fs-xs); }
.streaming-msg .msg-name { font-size: var(--fs-sm); font-weight: 600; }
.streaming-msg .msg-content { margin-left: 36px; max-width: 75%; }
.streaming-msg .msg-text { padding: 8px 12px; background: var(--color-surface-elevated); border-radius: 2px 12px 12px 12px; font-size: var(--fs-md); line-height: 1.5; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
.streaming-cursor { color: var(--color-primary); animation: pulse 1s infinite; font-size: 10px; margin-left: 2px; }

/* Layer 1: 流式工具调用状态指示器 */
.streaming-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.streaming-tool-tag {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px; border-radius: 4px; font-size: var(--fs-xs);
  background: var(--color-surface-elevated); border: 1px solid var(--color-border);
  color: var(--color-text-secondary); transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s, filter 0.2s;
}
.streaming-tool-tag.running { border-color: var(--color-primary); color: var(--color-primary); }
.streaming-tool-tag.completed { border-color: rgba(16, 185, 129, 0.3); color: #10b981; }
.streaming-tool-tag.failed { border-color: rgba(239, 68, 68, 0.3); color: #ef4444; }
.tc-spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
</style>