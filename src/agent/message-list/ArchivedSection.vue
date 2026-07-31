<template>
  <!-- P12 决策：已归档消息折叠提示（设计文档 5.5 节） -->
  <div class="archived-section" :class="{ expanded: showArchived }">
    <div class="archived-divider" @click="showArchived = !showArchived">
      <span class="archived-divider-icon"><WsIcon name="manuscript" size="s" /></span>
      <span class="archived-divider-text">
        {{ showArchived ? '收起' : '展开' }}已归档记忆（{{ archivedBoundaryIndex }} 条消息已归档）
      </span>
      <span class="archived-divider-chevron" :class="{ expanded: showArchived }">▸</span>
    </div>
    <Transition name="archived-expand">
      <div v-if="showArchived" class="archived-summary-body">
        <div v-if="archiveSummaryText" class="archived-summary-content" v-html="renderedSummary"></div>
        <div v-else class="archived-summary-empty">归档摘要不可用，请打开记忆库面板查看详情</div>
        <button class="archived-view-panel-btn" @click.stop="emit('open-archive-panel')">
          打开记忆库面板
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import WsIcon from '../../ui/WsIcon.vue'
import { renderArchiveSummary } from './utils'

const props = defineProps<{
  archivedBoundaryIndex: number
  archiveSummaryText: string
}>()

const emit = defineEmits<{
  'open-archive-panel': []
}>()

/** P12 决策：已归档消息折叠状态 */
const showArchived = ref(false)

/** 渲染归档摘要文本（简易 markdown），空文本时返回空串 */
const renderedSummary = computed(() => renderArchiveSummary(props.archiveSummaryText))
</script>

<style scoped>
.archived-section {
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--agent-primary, #3b82f6) 12%, transparent);
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 3%, transparent);
  overflow: hidden;
  animation: seg-in 0.3s ease-out;
  transition: border-color 0.3s, background 0.3s;
}

.archived-section.expanded {
  border-color: color-mix(in srgb, var(--agent-primary, #3b82f6) 20%, transparent);
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 5%, transparent);
}

.archived-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.archived-divider:hover {
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 8%, transparent);
}

.archived-divider-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 12%, transparent);
  color: var(--agent-primary, #3b82f6);
}

.archived-divider-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--agent-text);
  flex: 1;
  font-family: var(--agent-font);
}

.archived-divider-chevron {
  margin-left: auto;
  font-size: 10px;
  color: var(--agent-text-tertiary);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.archived-divider-chevron.expanded {
  transform: rotate(90deg);
}

.archived-summary-body {
  border-top: 1px solid color-mix(in srgb, var(--agent-primary, #3b82f6) 10%, transparent);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.archived-summary-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--agent-text);
  font-family: var(--agent-font);
  max-height: 300px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.archived-summary-content :deep(h4) {
  font-size: 13px;
  font-weight: 600;
  color: var(--agent-primary, #3b82f6);
  margin: 8px 0 4px 0;
}

.archived-summary-content :deep(h4:first-child) {
  margin-top: 0;
}

.archived-summary-content :deep(code) {
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}

.archived-summary-content :deep(strong) {
  color: var(--agent-text);
  font-weight: 600;
}

.archived-summary-empty {
  font-size: 12px;
  color: var(--agent-text-tertiary);
  font-style: italic;
  font-family: var(--agent-font);
}

.archived-view-panel-btn {
  align-self: flex-start;
  padding: 4px 12px;
  font-size: 12px;
  color: var(--agent-primary, #3b82f6);
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--agent-primary, #3b82f6) 20%, transparent);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  font-family: var(--agent-font);
}

.archived-view-panel-btn:hover {
  background: color-mix(in srgb, var(--agent-primary, #3b82f6) 18%, transparent);
}

/* 归档摘要展开/收缩动画 */
.archived-expand-enter-active,
.archived-expand-leave-active {
  transition: max-height 0.3s ease, opacity 0.2s ease;
  max-height: 400px;
  overflow: hidden;
}

.archived-expand-enter-from,
.archived-expand-leave-to {
  max-height: 0;
  opacity: 0;
}

@keyframes seg-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
