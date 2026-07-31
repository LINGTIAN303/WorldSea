<template>
  <div class="long-task-progress">
    <span class="ltp-heartbeat" :class="`ltp-hb-${heartbeatStatus}`" :title="heartbeatTitle"></span>
    <span class="ltp-label">运行中</span>
    <span class="ltp-duration">{{ formatElapsed(elapsedSec) }}</span>
    <!-- 方向 C 改进点 1：plan 进度（有 plan 时显示完成/总步数，让用户看到整体推进） -->
    <template v-if="planProgress.total > 0">
      <span class="ltp-sep">·</span>
      <span
        class="ltp-plan"
        :title="`任务进度 ${planProgress.completed}/${planProgress.total} 步（${planProgress.pct}%）`"
      >{{ planProgress.completed }}/{{ planProgress.total }} 步</span>
    </template>
    <span class="ltp-sep">·</span>
    <span class="ltp-turns">第 {{ turnCount }} 轮</span>
    <!-- 方向 C 改进点 3：当前 plan 步骤优先显示；无 in_progress 步骤时回退到当前 tool 名 -->
    <template v-if="currentPlanStep">
      <span class="ltp-sep">·</span>
      <span class="ltp-step" :title="`当前步骤: ${currentPlanStep}`">{{ currentPlanStep }}</span>
    </template>
    <template v-else-if="currentTool">
      <span class="ltp-sep">·</span>
      <span class="ltp-tool" :title="`正在执行: ${currentTool}`">{{ currentTool }}</span>
    </template>
    <button class="ltp-cancel" @click="emit('abort')" title="停止任务">停止</button>
  </div>
</template>

<script setup lang="ts">
import { formatElapsed } from './useLongTaskProgress'

defineProps<{
  /** 心跳状态：alive / stale / dead */
  heartbeatStatus: 'alive' | 'stale' | 'dead'
  /** 心跳状态 tooltip */
  heartbeatTitle: string
  /** 已运行秒数 */
  elapsedSec: number
  /** plan 进度（completed/total/pct） */
  planProgress: { completed: number; total: number; pct: number }
  /** 当前轮次（turnCount） */
  turnCount: number
  /** 当前 plan 步骤标题（无 in_progress 步骤时为空） */
  currentPlanStep: string
  /** 当前执行的 tool 名（无 plan 步骤时回退显示） */
  currentTool?: string
}>()

const emit = defineEmits<{
  (e: 'abort'): void
}>()
</script>

<style scoped>
/* 任务 4 P3：长任务进度条（面板底部，输入框上方） */
.long-task-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 24px 5px 12px; /* 右侧留白避开 resize-handle 角标 */
  background: rgba(16, 185, 129, 0.08);
  border-top: 1px solid rgba(16, 185, 129, 0.2);
  font-size: 11px;
  color: rgba(209, 250, 229, 0.85);
  flex-shrink: 0;
}
.ltp-heartbeat {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ltp-hb-alive {
  background: rgb(52, 211, 153);
  animation: ltp-blink 1.5s ease-in-out infinite;
}
.ltp-hb-stale {
  background: rgb(251, 191, 36);
  animation: ltp-blink 2.5s ease-in-out infinite;
}
.ltp-hb-dead {
  background: rgb(248, 113, 113);
}
@keyframes ltp-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.ltp-label {
  font-weight: 600;
  color: rgb(167, 243, 208);
}
.ltp-duration { font-variant-numeric: tabular-nums; }
.ltp-sep { color: rgba(209, 250, 229, 0.35); }
.ltp-tool {
  color: rgba(209, 250, 229, 0.65);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 方向 C：plan 进度数 + 当前步骤标题 */
.ltp-plan {
  font-variant-numeric: tabular-nums;
  color: rgb(167, 243, 208);
  font-weight: 600;
  flex-shrink: 0;
}
.ltp-step {
  color: rgba(209, 250, 229, 0.85);
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ltp-cancel {
  margin-left: auto;
  flex-shrink: 0;
  padding: 2px 10px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid rgba(248, 113, 113, 0.4);
  background: transparent;
  color: rgb(252, 165, 165);
  cursor: pointer;
  transition: background 0.15s;
}
.ltp-cancel:hover {
  background: rgba(248, 113, 113, 0.15);
}
</style>
