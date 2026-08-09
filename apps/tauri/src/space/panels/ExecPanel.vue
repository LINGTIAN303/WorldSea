<template>
  <div class="exec-panel">
    <div class="exec-tabs" role="tablist" aria-label="运行面板">
      <button
        role="tab"
        :aria-selected="tab === 'trace'"
        class="exec-tab"
        :class="{ on: tab === 'trace' }"
        @click="emit('update:tab', 'trace')"
      ><TuiIcon name="activity" size="sm" />轨迹</button>
      <button
        role="tab"
        :aria-selected="tab === 'activity'"
        class="exec-tab"
        :class="{ on: tab === 'activity' }"
        @click="emit('update:tab', 'activity')"
      ><TuiIcon name="chart" size="sm" />活动</button>
      <button
        role="tab"
        :aria-selected="tab === 'plan'"
        class="exec-tab"
        :class="{ on: tab === 'plan' }"
        @click="emit('update:tab', 'plan')"
      ><TuiIcon name="task" size="sm" />计划</button>
    </div>
    <div class="exec-body">
      <div v-show="tab === 'trace'" class="exec-pane" role="tabpanel">
        <PhaseSection :segments="deepSegments" />
        <SubAgentSection />
      </div>
      <div v-show="tab === 'activity'" class="exec-pane" role="tabpanel">
        <ActivityLog />
      </div>
      <div v-show="tab === 'plan'" class="exec-pane" role="tabpanel">
        <PlanPanel />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ExecPanel：Agent 空间右侧执行面板（双线分隔独立块，由 AgentSpace 外层承载边框与缝隙）。
 * 三 Tab：轨迹（PhaseSection + SubAgentSection，消费 useAgentRust deepSegments）/
 * 活动（ActivityLog）/ 计划（PlanPanel）。受控组件：tab 由父级（space-store.execTab）驱动。
 */
import TuiIcon from '@/components/ui/TuiIcon.vue'
import PhaseSection from '@/agent/components/PhaseSection.vue'
import SubAgentSection from '@/agent/components/SubAgentSection.vue'
import ActivityLog from '@/agent/panels/ActivityLog.vue'
import PlanPanel from '@/agent/panels/PlanPanel.vue'
import { useAgent } from '@/agent/composables/useAgent'
import type { ExecTab } from '../stores/space-store'

const props = defineProps<{ tab: ExecTab }>()
const emit = defineEmits<{ 'update:tab': [t: ExecTab] }>()

// 执行轨迹数据（useAgentRust 模块级单例，与 AgentWorkspace 同一数据源）
const { deepSegments } = useAgent()
</script>

<style scoped>
.exec-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--color-surface-elevated);
}

/* Tab 栏 */
.exec-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.exec-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.exec-tab:hover {
  color: var(--color-text-secondary);
}

.exec-tab.on {
  color: var(--color-primary);
  background: var(--color-surface);
  border-color: var(--color-border);
}

/* 面板内容 */
.exec-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}

.exec-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 窄面板内轨迹组件去外层限宽（PhaseSection/SubAgentSection 的 860px 上限在 300px 面板内无意义） */
.exec-pane :deep(.phase-section),
.exec-pane :deep(.subagent-section) {
  max-width: none;
  margin: 0;
}
</style>
