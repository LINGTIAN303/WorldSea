<template>
  <div v-if="tasks.length > 0" class="resume-banner">
    <div v-for="task in tasks" :key="task.taskId" class="resume-banner-item">
      <svg
        class="resume-banner-icon"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
      </svg>
      <div class="resume-banner-info">
        <div class="resume-banner-title">检测到未完成任务</div>
        <div class="resume-banner-desc">
          第 {{ task.turnCount }} 轮 · 已运行
          {{ Math.round((Date.now() - task.startedAt) / 1000) }}s<span
            v-if="task.currentTool"
          >
            · {{ task.currentTool }}</span>
        </div>
      </div>
      <button class="resume-btn resume-btn-primary" @click="emit('resume', task.taskId)">
        恢复
      </button>
      <button
        class="resume-btn resume-btn-secondary"
        @click="emit('discard', task.taskId)"
      >
        放弃
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { LongTaskRecord } from '../composables/longTaskStore'

defineProps<{
  /** 可恢复的长任务列表 */
  tasks: LongTaskRecord[]
}>()

const emit = defineEmits<{
  (e: 'resume', taskId: string): void
  (e: 'discard', taskId: string): void
}>()
</script>

<style scoped>
/* 任务 4 P2：断点恢复横幅 */
.resume-banner {
  padding: 6px 10px;
  background: rgba(99, 102, 241, 0.12);
  border-bottom: 1px solid rgba(99, 102, 241, 0.25);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.resume-banner-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.resume-banner-icon {
  color: rgb(129, 140, 248);
  flex-shrink: 0;
}
.resume-banner-info {
  flex: 1;
  min-width: 0;
}
.resume-banner-title {
  font-size: 12px;
  font-weight: 600;
  color: rgb(199, 210, 254);
}
.resume-banner-desc {
  font-size: 11px;
  color: rgba(199, 210, 254, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.resume-btn {
  flex-shrink: 0;
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
}
.resume-btn-primary {
  background: rgb(99, 102, 241);
  color: white;
}
.resume-btn-primary:hover {
  background: rgb(79, 70, 229);
}
.resume-btn-secondary {
  background: transparent;
  color: rgba(199, 210, 254, 0.8);
  border: 1px solid rgba(199, 210, 254, 0.3);
}
.resume-btn-secondary:hover {
  background: rgba(199, 210, 254, 0.1);
}
</style>
