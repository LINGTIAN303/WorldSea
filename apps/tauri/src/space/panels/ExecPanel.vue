<template>
  <div class="exec-panel">
    <!-- [①] 栏仅保留 + 号：新增式打开执行区（非切换） -->
    <div class="exec-bar">
      <div class="exec-bar-add-wrap" ref="addWrapRef">
        <button
          class="exec-add-btn"
          :class="{ active: addMenuOpen }"
          type="button"
          title="添加执行区"
          :aria-label="'添加执行区'"
          :aria-expanded="addMenuOpen"
          @click.stop="toggleAddMenu"
        ><WsIcon name="plus" size="sm" /></button>
      </div>
    </div>

    <div class="exec-body">
      <!-- 宫格首页：无任何区打开时显示 11 区四列宫格，点选追加打开 -->
      <div v-if="openExecSections.length === 0" class="exec-launcher">
        <p class="exec-launcher-hint">选择一个执行区</p>
        <div class="exec-grid">
          <button
            v-for="sec in EXEC_META"
            :key="sec.id"
            class="exec-grid-item"
            :title="sec.label"
            @click="openSection(sec.id)"
          >
            <WsIcon :name="sec.icon" size="md" class="exec-grid-icon" />
            <span class="exec-grid-label">{{ sec.label }}</span>
          </button>
        </div>
      </div>

      <!-- 多面板堆叠：已打开区以卡片纵向排列，可逐个关闭 -->
      <template v-else>
        <div
          v-for="sec in openExecSections"
          :key="sec"
          class="exec-card"
          :class="`exec-card-${sec}`"
        >
          <div class="exec-card-head">
            <WsIcon :name="metaOf(sec).icon" size="sm" class="exec-card-icon" />
            <span class="exec-card-title">{{ metaOf(sec).label }}</span>
            <button
              class="exec-card-close"
              type="button"
              :title="`关闭${metaOf(sec).label}`"
              :aria-label="`关闭${metaOf(sec).label}`"
              @click="removeExecSection(sec)"
            ><WsIcon name="close" size="xs" /></button>
          </div>
          <div class="exec-card-body">
            <template v-if="sec === 'trace'">
              <TracePanel />
              <SubAgentSection />
              <RunTreeSection />
            </template>
            <template v-else-if="sec === 'activity'">
              <ActivityLog />
            </template>
            <template v-else-if="sec === 'router'">
              <RouterPanel />
            </template>
            <template v-else-if="sec === 'tot'">
              <OrchestratorPanel
                mode="tot"
                title="ToT 思维树"
                icon="workflow"
                placeholder="输入问题，生成多分支思维树并评分…"
                run-label="开始思维树"
                empty-title="尚未运行思维树"
                empty-hint="输入问题，用多路径思维树推理并评分"
              />
            </template>
            <template v-else-if="sec === 'got'">
              <OrchestratorPanel
                mode="got"
                title="GoT 思维图"
                icon="mindmap"
                placeholder="输入问题，构建并聚合多路径思维图…"
                run-label="开始思维图"
                empty-title="尚未运行思维图"
                empty-hint="输入问题，构建图结构并聚合思考"
              />
            </template>
            <template v-else-if="sec === 'supervisor'">
              <OrchestratorPanel
                mode="supervisor"
                title="Supervisor 委派"
                icon="handshake"
                placeholder="输入任务，按子 Agent 能力委派…"
                run-label="开始委派"
                empty-title="尚未运行委派"
                empty-hint="输入任务，由 Supervisor 分配给多个子 Agent"
              />
            </template>
            <template v-else-if="sec === 'multi'">
              <MultiAgentPanel />
            </template>
            <template v-else-if="sec === 'terminal'">
              <TerminalView />
            </template>
            <template v-else-if="sec === 'subagent'">
              <SubAgentView />
            </template>
          </div>
        </div>
      </template>
    </div>

    <!-- + 号浮窗：四列宫格，仅列未打开的区 -->
    <Teleport to="body">
      <div v-if="addMenuOpen" class="exec-add-backdrop" @click="addMenuOpen = false"></div>
      <Transition name="dropdown">
        <div v-if="addMenuOpen" class="exec-add-menu" :style="addMenuStyle">
          <div class="exec-add-header">添加执行区</div>
          <div v-if="remainingSections.length" class="exec-grid exec-grid-menu">
            <button
              v-for="sec in remainingSections"
              :key="sec.id"
              class="exec-grid-item"
              :title="sec.label"
              @click="openSection(sec.id)"
            >
              <WsIcon :name="sec.icon" size="sm" class="exec-grid-icon" />
              <span class="exec-grid-label">{{ sec.label }}</span>
            </button>
          </div>
          <div v-else class="exec-add-empty">所有执行区均已打开</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * ExecPanel：Agent 空间右侧执行面板（宫格首页 + 加号新增式多面板，2026-08-29）。
 * 9 个执行区（轨迹/活动/Router/子Agent/ToT/GoT/委派/多Agent/终端；计划已移入消息流过程层内联展示；工作区已迁出至文件面板）不再以
 * tab 展示，改为：无区打开时内容区显示四列宫格首页；点选/点 + 号「新增」打开，卡片纵向堆叠；
 * 已打开的区从 + 号菜单中消失；关闭某卡片即移除。状态与会话绑定（useSessionViewState）。
 */
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import SubAgentSection from '@/agent/components/SubAgentSection.vue'
import RunTreeSection from '@/agent/components/RunTreeSection.vue'
import ActivityLog from '@/agent/panels/ActivityLog.vue'
import TracePanel from '@/agent/panels/TracePanel.vue'
import RouterPanel from '@/agent/panels/RouterPanel.vue'
import OrchestratorPanel from '@/agent/panels/OrchestratorPanel.vue'
import MultiAgentPanel from '@/agent/panels/MultiAgentPanel.vue'
import TerminalView from '@/terminal/components/TerminalView.vue'
import SubAgentView from '@/subagent/components/SubAgentView.vue'
import { useSessionViewState } from '@/agent/composables/useSessionViewState'
import type { ExecTab } from '../stores/space-store'

/** 9 个执行区元数据（宫格首页 / 卡片标题 / + 号菜单共用） */
const EXEC_META: { id: ExecTab; label: string; icon: string }[] = [
  { id: 'trace', label: '轨迹', icon: 'activity' },
  { id: 'activity', label: '活动', icon: 'chart' },
  { id: 'router', label: 'Router', icon: 'workflow' },
  { id: 'subagent', label: '子Agent', icon: 'user' },
  { id: 'tot', label: 'ToT', icon: 'workflow' },
  { id: 'got', label: 'GoT', icon: 'mindmap' },
  { id: 'supervisor', label: '委派', icon: 'handshake' },
  { id: 'multi', label: '多Agent', icon: 'workflow' },
  { id: 'terminal', label: '终端', icon: 'terminal' },
]

const sessionView = useSessionViewState()

const openExecSections = computed<ExecTab[]>(() => sessionView.activeState.value?.openExecSections ?? [])

function metaOf(id: ExecTab) {
  return EXEC_META.find(m => m.id === id) ?? { id, label: id, icon: 'layout-grid' }
}

/** 打开一个执行区（追加；已打开则幂等） */
function openSection(id: ExecTab) {
  sessionView.addExecSection(id)
  addMenuOpen.value = false
}

function removeExecSection(id: ExecTab) {
  sessionView.removeExecSection(id)
}

// ── + 号浮窗（新增式菜单，仅列未打开区） ──
const addMenuOpen = ref(false)
const addWrapRef = ref<HTMLElement>()
const addMenuStyle = ref<Record<string, string>>({ bottom: '8px', right: '8px' })

const remainingSections = computed(() =>
  EXEC_META.filter(m => !openExecSections.value.includes(m.id)),
)

function toggleAddMenu() {
  addMenuOpen.value = !addMenuOpen.value
  if (addMenuOpen.value) {
    const el = addWrapRef.value
    if (el) {
      const rect = el.getBoundingClientRect()
      addMenuStyle.value = {
        bottom: `${Math.max(8, window.innerHeight - rect.top + 6)}px`,
        right: `${Math.max(8, window.innerWidth - rect.right)}px`,
      }
    }
  }
}
</script>

<style scoped>
.exec-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--color-surface-elevated);
}

/* [①] 栏：仅 + 号 */
.exec-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.exec-bar-add-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.exec-add-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.exec-add-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.exec-add-btn.active {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}

/* 面板内容 */
.exec-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 宫格首页：四列 */
.exec-launcher {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 8px;
  flex: 1;
}
.exec-launcher-hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.exec-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  width: 100%;
}
.exec-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.15s;
}
.exec-grid-item:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
  transform: translateY(-1px);
}
.exec-grid-icon {
  color: var(--color-text-tertiary);
  transition: color 0.15s;
}
.exec-grid-item:hover .exec-grid-icon {
  color: var(--color-primary);
}
.exec-grid-label {
  font-size: var(--font-size-2xs);
  white-space: nowrap;
}

/* 多面板卡片 */
.exec-card {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;
}
.exec-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface-elevated);
  flex-shrink: 0;
}
.exec-card-icon {
  color: var(--color-primary);
}
.exec-card-title {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exec-card-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.exec-card-close:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.exec-card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 40vh;
  overflow-y: auto;
  padding: 10px;
}
/* 窄面板内轨迹组件去外层限宽 */
.exec-card-body :deep(.phase-section),
.exec-card-body :deep(.subagent-section),
.exec-card-body :deep(.run-tree-section) {
  max-width: none;
  margin: 0;
}
/* 终端/子Agent/工作区迁入卡片：撑满卡片内容区 */
.exec-card-terminal .exec-card-body,
.exec-card-subagent .exec-card-body,
.exec-card-workspace .exec-card-body {
  max-height: 55vh;
}
.exec-card-body :deep(.terminal-view),
.exec-card-body :deep(.subagent),
.exec-card-body :deep(.agent-settings),
.exec-card-body :deep(.subagent-view),
.exec-card-body :deep(.workspace-panel) {
  height: 100%;
  max-width: none;
}

/* + 号浮窗 */
.exec-add-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
}
.exec-add-menu {
  position: fixed;
  min-width: 280px;
  max-width: 320px;
  background: var(--color-surface-elevated);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 8px;
  z-index: 10001;
}
.exec-add-header {
  padding: 2px 4px 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 8px;
}
.exec-grid-menu {
  gap: 6px;
}
.exec-grid-menu .exec-grid-item {
  padding: 8px 2px;
}
.exec-add-empty {
  padding: 16px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
</style>
