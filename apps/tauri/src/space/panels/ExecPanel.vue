<template>
  <div class="exec-panel">
    <div class="exec-tabs" role="tablist" aria-label="运行面板">
      <button
        role="tab"
        :aria-selected="tab === 'trace'"
        class="exec-tab"
        :class="{ on: tab === 'trace' }"
        @click="emit('update:tab', 'trace')"
      ><WsIcon name="activity" size="sm" :stroke-width="1.7" />轨迹</button>
      <button
        role="tab"
        :aria-selected="tab === 'activity'"
        class="exec-tab"
        :class="{ on: tab === 'activity' }"
        @click="emit('update:tab', 'activity')"
      ><WsIcon name="chart" size="sm" :stroke-width="1.7" />活动</button>
      <button
        role="tab"
        :aria-selected="tab === 'plan'"
        class="exec-tab"
        :class="{ on: tab === 'plan' }"
        @click="emit('update:tab', 'plan')"
      ><WsIcon name="task" size="sm" :stroke-width="1.7" />计划</button>
      <button
        role="tab"
        :aria-selected="tab === 'router'"
        class="exec-tab"
        :class="{ on: tab === 'router' }"
        @click="emit('update:tab', 'router')"
      ><WsIcon name="workflow" size="sm" :stroke-width="1.7" />Router</button>
      <button
        role="tab"
        :aria-selected="tab === 'subagent'"
        class="exec-tab"
        :class="{ on: tab === 'subagent' }"
        @click="emit('update:tab', 'subagent')"
      ><WsIcon name="user" size="sm" :stroke-width="1.7" />子Agent</button>
      <button
        role="tab"
        :aria-selected="tab === 'tot'"
        class="exec-tab"
        :class="{ on: tab === 'tot' }"
        @click="emit('update:tab', 'tot')"
      ><WsIcon name="workflow" size="sm" :stroke-width="1.7" />ToT</button>
      <button
        role="tab"
        :aria-selected="tab === 'got'"
        class="exec-tab"
        :class="{ on: tab === 'got' }"
        @click="emit('update:tab', 'got')"
      ><WsIcon name="mindmap" size="sm" :stroke-width="1.7" />GoT</button>
      <button
        role="tab"
        :aria-selected="tab === 'supervisor'"
        class="exec-tab"
        :class="{ on: tab === 'supervisor' }"
        @click="emit('update:tab', 'supervisor')"
      ><WsIcon name="handshake" size="sm" :stroke-width="1.7" />委派</button>
      <button
        role="tab"
        :aria-selected="tab === 'multi'"
        class="exec-tab"
        :class="{ on: tab === 'multi' }"
        @click="emit('update:tab', 'multi')"
      ><WsIcon name="workflow" size="sm" :stroke-width="1.7" />多Agent</button>
      <button
        role="tab"
        :aria-selected="tab === 'terminal'"
        class="exec-tab"
        :class="{ on: tab === 'terminal' }"
        @click="emit('update:tab', 'terminal')"
      ><WsIcon name="terminal" size="sm" :stroke-width="1.7" />终端</button>
      <button
        role="tab"
        :aria-selected="tab === 'workspace'"
        class="exec-tab"
        :class="{ on: tab === 'workspace' }"
        @click="emit('update:tab', 'workspace')"
      ><WsIcon name="folder" size="sm" :stroke-width="1.7" />工作区</button>
    </div>
    <div class="exec-body">
      <div v-show="tab === 'trace'" class="exec-pane" role="tabpanel">
        <!-- [⑤] 轨迹 = turn 级结构化表格 + 阶段折叠 -->
        <TracePanel />
        <PhaseSection :segments="deepSegments" />
        <SubAgentSection />
        <!-- M3-RK1 前端可视化：会话 run 树（顶层 + 委派子 run，list_session_runs 数据源） -->
        <RunTreeSection />
      </div>
      <div v-show="tab === 'activity'" class="exec-pane" role="tabpanel">
        <ActivityLog />
      </div>
      <div v-show="tab === 'plan'" class="exec-pane" role="tabpanel">
        <PlanPanel />
      </div>
      <div v-show="tab === 'router'" class="exec-pane" role="tabpanel">
        <RouterPanel />
      </div>
      <div v-show="tab === 'tot'" class="exec-pane" role="tabpanel">
        <OrchestratorPanel
          mode="tot"
          title="ToT 思维树"
          icon="workflow"
          placeholder="输入问题，生成多分支思维树并评分…"
          run-label="开始思维树"
          empty-title="尚未运行思维树"
          empty-hint="输入问题，用多路径思维树推理并评分"
        />
      </div>
      <div v-show="tab === 'got'" class="exec-pane" role="tabpanel">
        <OrchestratorPanel
          mode="got"
          title="GoT 思维图"
          icon="mindmap"
          placeholder="输入问题，构建并聚合多路径思维图…"
          run-label="开始思维图"
          empty-title="尚未运行思维图"
          empty-hint="输入问题，构建图结构并聚合思考"
        />
      </div>
      <div v-show="tab === 'supervisor'" class="exec-pane" role="tabpanel">
        <OrchestratorPanel
          mode="supervisor"
          title="Supervisor 委派"
          icon="handshake"
          placeholder="输入任务，按子 Agent 能力委派…"
          run-label="开始委派"
          empty-title="尚未运行委派"
          empty-hint="输入任务，由 Supervisor 分配给多个子 Agent"
        />
      </div>
      <div v-show="tab === 'multi'" class="exec-pane" role="tabpanel">
        <MultiAgentPanel />
      </div>
      <div v-show="tab === 'terminal'" class="exec-pane exec-pane-terminal" role="tabpanel">
        <TerminalView />
      </div>
      <div v-show="tab === 'subagent'" class="exec-pane exec-pane-subagent" role="tabpanel">
        <SubAgentView />
      </div>
      <div v-show="tab === 'workspace'" class="exec-pane exec-pane-workspace" role="tabpanel">
        <WorkspacePanel />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ExecPanel：Agent 空间右侧执行面板（双线分隔独立块，由 AgentSpace 外层承载边框与缝隙）。
 * 多 Tab：轨迹（PhaseSection + SubAgentSection，消费 useAgentRust deepSegments）/
 * 活动（ActivityLog）/ 计划（PlanPanel）/ 终端（TerminalView，工作台 Agent 视图迁入）/
 * 子Agent（SubAgentView 规格管理，工作台 Agent 视图迁入）/ 工作区（WorkspacePanel，Phase 4 本地文件系统）。
 * 受控组件：tab 由父级（viewState 会话级 execTab）驱动。
 */
import { WsIcon } from '@worldsmith/ui-kit'
import PhaseSection from '@/agent/components/PhaseSection.vue'
import SubAgentSection from '@/agent/components/SubAgentSection.vue'
import RunTreeSection from '@/agent/components/RunTreeSection.vue'
import ActivityLog from '@/agent/panels/ActivityLog.vue'
import TracePanel from '@/agent/panels/TracePanel.vue'
import PlanPanel from '@/agent/panels/PlanPanel.vue'
import RouterPanel from '@/agent/panels/RouterPanel.vue'
import OrchestratorPanel from '@/agent/panels/OrchestratorPanel.vue'
import MultiAgentPanel from '@/agent/panels/MultiAgentPanel.vue'
import TerminalView from '@/terminal/components/TerminalView.vue'
import SubAgentView from '@/subagent/components/SubAgentView.vue'
import WorkspacePanel from '@/space/panels/WorkspacePanel.vue'
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

/* Tab 栏（[C] 10 子 Tab 横向滚动） */
.exec-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.exec-tabs::-webkit-scrollbar {
  display: none;
}

.exec-tab {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  white-space: nowrap;
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

/* 窄面板内轨迹组件去外层限宽（PhaseSection/SubAgentSection/RunTreeSection 的 860px 上限在 300px 面板内无意义） */
.exec-pane :deep(.phase-section),
.exec-pane :deep(.subagent-section),
.exec-pane :deep(.run-tree-section) {
  max-width: none;
  margin: 0;
}

/* 终端/子Agent/工作区 迁入面板：撑满面板高度，去外层限宽 */
.exec-pane-terminal,
.exec-pane-subagent,
.exec-pane-workspace {
  flex: 1;
  min-height: 0;
}
.exec-pane-terminal :deep(.terminal-view),
.exec-pane-subagent :deep(.subagent),
.exec-pane-subagent :deep(.agent-settings),
.exec-pane-subagent :deep(.subagent-view),
.exec-pane-workspace :deep(.workspace-panel) {
  height: 100%;
  max-width: none;
}
</style>
