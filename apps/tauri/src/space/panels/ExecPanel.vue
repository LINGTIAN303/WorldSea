<template>
  <div class="exec-panel">
    <!-- 已打开区标签栏（2026-09-03 UI 视觉改造：标签贴栏切换 + 尾部宫格总览按钮；
         原孤立 + 按钮与其浮窗（浮窗定位越界不可见）一并移除，追加入口改由宫格总览承接） -->
    <div v-if="openExecSections.length > 0" ref="tabsRef" class="exec-tabs" @wheel="onTabsWheel">
      <button
        v-for="sec in openExecSections"
        :key="sec"
        class="exec-tab"
        :class="{ active: sec === activeSection, dragging: dragId === sec }"
        type="button"
        :title="metaOf(sec).label"
        draggable="true"
        @click="onSelectTab(sec)"
        @dragstart="onDragStart(sec, $event)"
        @dragover="onDragOver(sec, $event)"
        @drop="onDrop"
        @dragend="onDragEnd"
      >
        <WsIcon :name="metaOf(sec).icon" size="xs" class="exec-tab-icon" />
        <span class="exec-tab-label">{{ metaOf(sec).label }}</span>
        <span
          class="exec-tab-close"
          role="button"
          :aria-label="`关闭${metaOf(sec).label}`"
          title="关闭"
          @click.stop="removeExecSection(sec)"
        ><WsIcon name="close" size="xs" /></span>
      </button>
      <div class="exec-add-wrap" ref="addWrapRef">
        <button
          class="exec-add-btn"
          :class="{ active: addMenuOpen }"
          type="button"
          title="添加执行区"
          :aria-label="'添加执行区'"
          :aria-expanded="addMenuOpen"
          @click.stop="toggleAddMenu"
        ><WsIcon name="plus" size="xs" /></button>
      </div>
    </div>

    <div class="exec-body">
      <!-- 宫格（启动页）：3×3 小正方形，面板居中；无已开区时为唯一内容 -->
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

      <!-- 区内容直显（2026-09-03 改造：去掉卡片容器框，激活区内容直接铺在面板内） -->
      <div v-else class="exec-view">
        <template v-if="activeSection === 'trace'">
          <TracePanel />
          <SubAgentSection />
          <RunTreeSection />
        </template>
        <template v-else-if="activeSection === 'activity'">
          <ActivityLog />
        </template>
        <template v-else-if="activeSection === 'sessionlog'">
          <SessionLogPanel />
        </template>
        <template v-else-if="activeSection === 'supervisor'">
          <OrchestratorPanel
            mode="supervisor"
            title="Supervisor 委派"
            icon="handshake"
            empty-title="本会话暂无委派现场"
            empty-hint="本会话暂无编排现场，历史 run 可在会话中展开编排段查看。"
          />
        </template>
        <template v-else-if="activeSection === 'terminal'">
          <TerminalView />
        </template>
        <template v-else-if="activeSection === 'subagent'">
          <SubAgentView />
        </template>
      </div>
    </div>

    <!-- + 号浮窗：宫格菜单，仅列未打开的区（2026-09-03 修复：按钮下方展开 + 四边边缘检测，不再越界裁剪） -->
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
 * ExecPanel：Agent 空间右侧执行面板（2026-09-03 UI 视觉改造）。
 * 执行区（轨迹/活动/Router/子Agent/委派/终端；2026-09-09 消除 ToT/GoT 区、
 * 2026-09-09 消除 multi 区——多 Agent 协作已由群聊会议承载，历史现场迁移至群聊界面）。
 * 形态：已打开区以标签贴在面板首栏（点击切换、✕ 关闭），激活区内容无容器框直显面板；
 * 标签栏尾部 + 号浮窗追加执行区（按钮下方展开 + 边缘检测，修复原越界不可见）；无已开区时 3×3 居中宫格为唯一内容。
 * 状态与会话绑定（useSessionViewState）：openExecSections 已开列表 + execTab 激活区，
 * addExecSection 打开即激活、removeExecSection 关闭当前区自动回退最后一个。
 */
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import SubAgentSection from '@/agent/components/SubAgentSection.vue'
import RunTreeSection from '@/agent/components/RunTreeSection.vue'
import ActivityLog from '@/agent/panels/ActivityLog.vue'
import TracePanel from '@/agent/panels/TracePanel.vue'
import SessionLogPanel from '@/agent/panels/SessionLogPanel.vue'
import OrchestratorPanel from '@/agent/panels/OrchestratorPanel.vue'
import TerminalView from '@/terminal/components/TerminalView.vue'
import SubAgentView from '@/subagent/components/SubAgentView.vue'
import { useSessionViewState } from '@/agent/composables/useSessionViewState'
import type { ExecTab } from '../stores/space-store'

/** 6 个执行区元数据（宫格 / 标签共用；顺序即 3×3 宫格排布；
    2026-09-09 右栏消除 tot/got/multi/router 区——ToT/GoT/multi 已迁创作编排承载面、
    Router 归场景识别底座，见 docs/plans/2026-09-09-编排双轨收口审查与6模块迁移.md；
    2026-09-12 新增「会话日志」区（A1 R3，设计文档 §10.3） */
const EXEC_META: { id: ExecTab; label: string; icon: string }[] = [
  { id: 'trace', label: '轨迹', icon: 'activity' },
  { id: 'activity', label: '活动', icon: 'chart' },
  { id: 'sessionlog', label: '会话日志', icon: 'scroll' },
  { id: 'subagent', label: '子Agent', icon: 'user' },
  { id: 'supervisor', label: '委派', icon: 'handshake' },
  { id: 'terminal', label: '终端', icon: 'terminal' },
]

const sessionView = useSessionViewState()

const openExecSections = computed<ExecTab[]>(() => sessionView.activeState.value?.openExecSections ?? [])

/** 当前激活区（execTab 权威；不在已开列表时回退最后一个已开区） */
const activeSection = computed<ExecTab | null>(() => {
  const open = openExecSections.value
  if (open.length === 0) return null
  const cur = sessionView.activeState.value?.execTab
  return cur && open.includes(cur) ? cur : open[open.length - 1]
})

/** + 号浮窗（添加执行区菜单，仅列未打开区） */
const addMenuOpen = ref(false)
const addWrapRef = ref<HTMLElement>()
const addMenuStyle = ref<Record<string, string>>({ top: '40px', right: '10px' })

const remainingSections = computed(() =>
  EXEC_META.filter(m => !openExecSections.value.includes(m.id)),
)

/** 浮窗定位：按钮下方展开；越界时四边回拉（修复原 bottom 定位把浮窗推出视口顶部不可见） */
function toggleAddMenu() {
  addMenuOpen.value = !addMenuOpen.value
  if (addMenuOpen.value) {
    const el = addWrapRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const MENU_W = 300
    const MENU_H = 250
    let top = rect.bottom + 6
    if (top + MENU_H > window.innerHeight - 8) top = Math.max(8, window.innerHeight - MENU_H - 8)
    let left = rect.right - MENU_W
    if (left < 8) left = 8
    if (left + MENU_W > window.innerWidth - 8) left = window.innerWidth - MENU_W - 8
    addMenuStyle.value = { top: `${top}px`, left: `${left}px` }
  }
}

function metaOf(id: ExecTab) {
  return EXEC_META.find(m => m.id === id) ?? { id, label: id, icon: 'layout-grid' }
}

/** 打开一个执行区（宫格/浮窗点选；addExecSection 幂等且打开即激活）并关闭浮窗 */
function openSection(id: ExecTab) {
  sessionView.addExecSection(id)
  addMenuOpen.value = false
}

/** 点击标签：激活该区 */
function onSelectTab(id: ExecTab) {
  sessionView.setExecTab(id)
}

function removeExecSection(id: ExecTab) {
  sessionView.removeExecSection(id)
}

// ── 标签栏交互（2026-09-03）：滚轮横滚 + 标签拖拽换位 ──

const tabsRef = ref<HTMLElement | null>(null)

/** 鼠标滚轮横滚：纵向滚轮增量转横向滚动（滚动条已隐藏，滚轮是唯一横滚手段） */
function onTabsWheel(e: WheelEvent) {
  const el = tabsRef.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
}

/** 拖拽中的标签 id（null = 无拖拽） */
const dragId = ref<ExecTab | null>(null)

function onDragStart(id: ExecTab, e: DragEvent) {
  dragId.value = id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Firefox 要求非空 data 才会启动 drag
    e.dataTransfer.setData('text/plain', id)
  }
}

/** 拖经其他标签即实时换位（浏览器标签式排序预览），松手即落定 */
function onDragOver(id: ExecTab, e: DragEvent) {
  if (dragId.value == null || dragId.value === id) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  sessionView.reorderExecSections(dragId.value, id)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
}

function onDragEnd() {
  dragId.value = null
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

/* 已打开区标签栏（面板首栏）：横向滚动，尾部宫格总览按钮 */
.exec-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.exec-tabs::-webkit-scrollbar {
  display: none;
}
.exec-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.exec-tab:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}
.exec-tab.active {
  border-color: var(--color-primary);
  background: var(--color-primary-muted);
  color: var(--color-primary);
  font-weight: 600;
}
.exec-tab-label {
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.exec-tab-icon {
  flex-shrink: 0;
}
.exec-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: var(--radius-xs);
  color: var(--color-text-tertiary);
  transition: background 0.12s, color 0.12s;
}
.exec-tab-close:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
/* 拖拽中的标签半透明（换位实时预览） */
.exec-tab.dragging {
  opacity: 0.4;
}
/* 标签栏尾部 + 按钮：追加执行区入口 */
.exec-add-wrap {
  position: relative;
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-shrink: 0;
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

/* 宫格（启动/总览）：3×3 小正方形，水平垂直居中 */
.exec-launcher {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 16px 8px;
  flex: 1;
}
.exec-launcher-hint {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.exec-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  width: 100%;
  max-width: 340px;
}
.exec-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  aspect-ratio: 1;
  padding: 4px;
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

/* 区内容直显：无容器框，占满面板剩余空间 */
.exec-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 自然流组件去外层限宽 */
.exec-view :deep(.phase-section),
.exec-view :deep(.subagent-section),
.exec-view :deep(.run-tree-section) {
  max-width: none;
  margin: 0;
}
/* 终端/子Agent 等视口型组件：撑满内容区（原卡片 55vh 限高改为随面板） */
.exec-view :deep(.terminal-view),
.exec-view :deep(.subagent),
.exec-view :deep(.agent-settings),
.exec-view :deep(.subagent-view) {
  flex: 1;
  min-height: 0;
  height: auto;
  max-height: none;
  max-width: none;
}

/* 减动效兜底：宫格 hover 位移归零 */
:root[data-anim-panels='off'] .exec-grid-item:hover {
  transform: none;
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
  display: grid;
  grid-template-columns: repeat(4, 1fr);
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
:root[data-anim-panels='off'] .dropdown-enter-from,
:root[data-anim-panels='off'] .dropdown-leave-to {
  transform: none;
}
</style>
