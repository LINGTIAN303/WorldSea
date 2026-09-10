<template>
  <div class="orchestrator-panel">
    <!-- 实时现场区：Supervisor 委派日志（只读查看） -->
    <div v-if="liveActive" class="op-live">
      <div class="op-live-label">实时</div>

      <template v-if="supervisorTasks.length">
        <ul class="op-live-tasks">
          <li
            v-for="(t, i) in supervisorTasks"
            :key="t.subAgentId + i"
            class="op-live-task"
            :class="`is-${t.status}`"
          >
            <span class="op-live-task-status" :title="t.status">{{ taskStatusText(t.status) }}</span>
            <span class="op-live-task-main">
              <span class="op-live-task-name">{{ t.subAgentName }}</span>
              <code class="op-live-task-id">{{ t.subAgentId }}</code>
            </span>
            <span class="op-live-task-desc">{{ t.taskDescription }}</span>
            <span v-if="t.status === 'completed'" class="op-live-task-out">
              {{ t.outputChars ?? 0 }} 字 · {{ t.durationMs ?? 0 }}ms
            </span>
          </li>
        </ul>
      </template>
    </div>

    <div v-if="!liveActive" class="op-empty">
      <TuiEmpty :icon="icon" :fill="false" :title="emptyTitle" :hint="emptyHint" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Supervisor 委派现场只读查看面板。
 * 2026-09-09 右栏消除 tot/got 区（ToT/GoT 已迁创作编排承载面），本面板仅保留
 * Supervisor 委派任务日志（现场来自 useOrchEvents 单例，会话生命周期事件监听）。
 * 只读，无输入焦点。
 */
import { computed } from 'vue'
import TuiEmpty from '@/components/ui/TuiEmpty.vue'
import { useOrchEvents, type OrchTask } from '../composables/useOrchEvents'

const props = defineProps<{
  mode: string
  title: string
  icon: string
  emptyTitle: string
  emptyHint: string
}>()

const orch = useOrchEvents()
const { supervisorTasks } = orch

// ─── 实时现场可见性 ───
const liveActive = computed<boolean>(() => supervisorTasks.value.length > 0)

function taskStatusText(s: OrchTask['status']): string {
  return s === 'assigned' ? '已分配' : s === 'running' ? '执行中' : '已完成'
}
</script>

<style scoped>
.orchestrator-panel { display: flex; flex-direction: column; gap: 12px; }

/* 实时区 */
.op-live { padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-muted); }
.op-live-label { display: flex; align-items: center; gap: 8px; font-size: var(--fs-xs); color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.op-live-tasks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.op-live-task { display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--bg-surface); border: 1px solid var(--border); }
.op-live-task.is-running { border-color: var(--accent); }
.op-live-task.is-completed { opacity: 0.85; }
.op-live-task-status { flex-shrink: 0; font-size: var(--fs-2xs); font-weight: 600; padding: 1px 6px; border-radius: 4px; }
.op-live-task-status.is-assigned { background: var(--bg-muted); color: var(--text-muted); }
.op-live-task.is-running .op-live-task-status { background: var(--accent-soft); color: var(--accent); }
.op-live-task.is-completed .op-live-task-status { background: var(--success-soft, rgba(46,160,67,.12)); color: var(--success, #2ea043); }
.op-live-task-main { display: inline-flex; align-items: baseline; gap: 6px; flex-shrink: 0; }
.op-live-task-name { font-size: var(--fs-xs); font-weight: 600; color: var(--text-primary); }
.op-live-task-id { font-size: var(--fs-2xs); color: var(--accent); background: var(--accent-soft); padding: 0 5px; border-radius: var(--radius-sm); }
.op-live-task-desc { flex: 1; min-width: 0; font-size: var(--fs-xs); color: var(--text-secondary); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.op-live-task-out { flex-shrink: 0; font-size: var(--fs-2xs); color: var(--text-muted); }
</style>