<template>
  <div class="shell">
    <TitleBar />
    <WelcomeOverlay />
    <div id="main-content" tabindex="-1" class="shell-body" :class="{ 'sidebar-right': settingsStore.sidebarPosition === 'right' }">
      <Sidebar />
      <ViewContainer />
    </div>
    <GlobalSearch :show="searchOpen" @close="searchOpen = false" />
    <ImportExportModal :show="importExportOpen" @close="importExportOpen = false" />
    <Toast />
    <DialogContainer />
    <WsConfirmDialog />
    <WsAskDialog />
    <BatchEditModal :show="batchEditOpen" @close="batchEditOpen = false" />
    <TemplateManager :show="templateOpen" @close="templateOpen = false" />
    <VersionHistory :show="versionOpen" @close="versionOpen = false" />
    <DocExport :show="docOpen" @close="docOpen = false" />
    <LayoutManager :show="layoutMgrOpen" @close="layoutMgrOpen = false" />
    <ShortcutHelpModal :show="shortcutHelpOpen" @close="shortcutHelpOpen = false" />
    <UndoHistoryPanel :show="undoHistoryOpen" @close="undoHistoryOpen = false" @redo="onRedoFromHistory" />
    <InfoPanel />
    <TrashPanel :show="trashOpen" @close="trashOpen = false" />
    <ArtifactsPanel :show="artifactsOpen" @close="artifactsOpen = false" />
    <ConsistencyReportPanel :show="consistencyOpen" @close="consistencyOpen = false" />
    <SettingsDialog :show="settingsOpen" @close="settingsOpen = false" />
    <ThemeEditor :show="themeEditorOpen" @close="themeEditorOpen = false" />
    <CustomRelationTypeDialog :show="customRelTypeOpen" @close="customRelTypeOpen = false" />
    <EntityTemplateDialog :show="entityTemplateOpen" @close="entityTemplateOpen = false" />
    <CompanionNotification :notifications="companionNotifications" :session-memory="companionSessionMemory" @dismiss="dismissNotification" @pin="pinNotification" @unpin="unpinNotification" />
  </div>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue'
import TitleBar from './TitleBar.vue'
import Sidebar from './sidebar/SidebarV2.vue'
import { Toast, DialogContainer, ViewContainer } from '@worldsea/ui-kit'
import WsConfirmDialog from '../WsConfirmDialog.vue'
import WsAskDialog from '../WsAskDialog.vue'

const WelcomeOverlay = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.WelcomeOverlay))
const GlobalSearch = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.GlobalSearch))
const ImportExportModal = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.ImportExportModal))
import { BatchEditModal } from '@worldsea/plugin-sdk'
const TemplateManager = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.TemplateManager))
const VersionHistory = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.VersionHistory))
const DocExport = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.DocExport))
const LayoutManager = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.LayoutManager))
const ShortcutHelpModal = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.ShortcutHelpModal))
const UndoHistoryPanel = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.UndoHistoryPanel))
const InfoPanel = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.InfoPanel))
import { useShortcuts, useUndoRedo, useGlobalEvents } from '@worldsea/ui-kit'
import { usePluginStore, useDirtyTracker, useEntityStore, useRelationStore, entitySchemaRegistry, relationshipRegistry, useUIStore, useSettingsStore } from '@worldsea/entity-core'
import { useFileSystemProject } from '@worldsea/entity-core/composables'
// D2-b2：useProjectSwitcher 引用已随「打开目录建项目」入口退役移除（项目切换在 ProjectSwitcher 下拉）
import { switchShell } from '@/composables/shellSwitch'
import CompanionNotification from '../companion/CompanionNotification.vue'
import { useCompanionMode } from '@worldsea/shared-composables/companion/useCompanionMode'

const searchOpen = ref(false)
const importExportOpen = ref(false)
const batchEditOpen = ref(false)
const templateOpen = ref(false)
const versionOpen = ref(false)
const docOpen = ref(false)
const layoutMgrOpen = ref(false)
const shortcutHelpOpen = ref(false)
const undoHistoryOpen = ref(false)

// P3-W4 续：恢复业务弹窗（TrashPanel / ConsistencyReportPanel / SettingsDialog /
// CustomRelationTypeDialog / EntityTemplateDialog）
const trashOpen = ref(false)
const artifactsOpen = ref(false)
const consistencyOpen = ref(false)
const settingsOpen = ref(false)
const customRelTypeOpen = ref(false)
const entityTemplateOpen = ref(false)
const themeEditorOpen = ref(false)

const TrashPanel = defineAsyncComponent(() => import('@/ui/data/TrashPanel.vue'))
const ArtifactsPanel = defineAsyncComponent(() => import('@/ui/data/ArtifactsPanel.vue'))
const ConsistencyReportPanel = defineAsyncComponent(() => import('@/ui/data/ConsistencyReportPanel.vue'))
const SettingsDialog = defineAsyncComponent(() => import('@/ui/settings/SettingsDialog.vue'))
const ThemeEditor = defineAsyncComponent(() => import('@/components/theme-editor/ThemeEditor.vue'))
const CustomRelationTypeDialog = defineAsyncComponent(() => import('@/ui/entity/CustomRelationTypeDialog.vue'))
const EntityTemplateDialog = defineAsyncComponent(() => import('@/ui/entity/EntityTemplateDialog.vue'))

function onOpenSearch() { searchOpen.value = true }
function onOpenImportExport() { importExportOpen.value = true }
function onOpenBatchEdit() { batchEditOpen.value = true }
function onOpenTemplate() { templateOpen.value = true }
function onOpenVersion() { versionOpen.value = true }
function onOpenDocExport() { docOpen.value = true }
function onOpenLayoutMgr() { layoutMgrOpen.value = true }
function onOpenTrash() { trashOpen.value = true }
function onOpenArtifacts() { artifactsOpen.value = true }
function onOpenConsistency() { consistencyOpen.value = true }
function onOpenSettings() { settingsOpen.value = true }
function onOpenThemeEditor() { themeEditorOpen.value = true }
function onOpenCustomRelType() { customRelTypeOpen.value = true }
function onOpenEntityTemplate() { entityTemplateOpen.value = true }
// D2-b2（2026-09-28）：项目 = dsh 工作区（同源）——「打开目录建项目」入口与 ws-open-project-manager
// 事件随 useProjectSwitcher 的入口删除一并退役；项目新建/管理在 Agent 空间 dsh 界面进行。

const pluginStore = usePluginStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const { notifications: companionNotifications, dismissNotification, pinNotification, unpinNotification, notifyViewSwitch, sessionMemory: companionSessionMemory } = useCompanionMode()

onMounted(() => {
  // 注册 beforeunload 防丢失提醒
  const { setupBeforeUnload } = useDirtyTracker()
  const cleanupBeforeUnload = setupBeforeUnload()
  onUnmounted(() => cleanupBeforeUnload())
  // 加载持久化的自定义关系类型
  relationshipRegistry.loadCustomTypes()
})

function onWsNavigate(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail) return
  const { view: entityType, entityId } = detail
  const schema = entitySchemaRegistry.get(entityType)
  const pluginId = schema?.pluginId
  const targetView = pluginStore.views.find(v => v.pluginId === pluginId)
  if (targetView) {
    uiStore.setView(targetView.id)
    uiStore.viewComponent = targetView.component
  }
  if (entityId) {
    uiStore.selectEntity(entityId)
    window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId } }))
  }
}

const { on: onGlobalEvent } = useGlobalEvents()

onGlobalEvent('ws-open-search', onOpenSearch)
onGlobalEvent('ws-open-import-export', onOpenImportExport)
onGlobalEvent('ws-open-batch-edit', onOpenBatchEdit)
onGlobalEvent('ws-open-template', onOpenTemplate)
onGlobalEvent('ws-open-version', onOpenVersion)
onGlobalEvent('ws-open-doc-export', onOpenDocExport)
onGlobalEvent('ws-open-layout-mgr', onOpenLayoutMgr)
// P3-W4 续：恢复业务弹窗全局事件
onGlobalEvent('ws-open-trash', onOpenTrash)
onGlobalEvent('ws-open-artifacts', onOpenArtifacts)
onGlobalEvent('ws-open-consistency', onOpenConsistency)
// 设置/帮助事件（快捷键 handler / AppMenu / 托盘统一 dispatch 全局事件）：本页即工作台，
// 直接打开（2026-09-30 C 批去陈旧壳守卫——旧「仅在激活壳打开」的前提随双窗改造消失）
onGlobalEvent('ws-open-settings', () => { onOpenSettings() })
onGlobalEvent('ws-open-shortcut-help', () => { shortcutHelpOpen.value = true })
onGlobalEvent('ws-open-theme-editor', onOpenThemeEditor)
onGlobalEvent('ws-open-custom-rel-type', onOpenCustomRelType)
onGlobalEvent('ws-open-entity-template', onOpenEntityTemplate)
onGlobalEvent('ws-navigate', onWsNavigate)

onMounted(() => {
  const { tryRestoreProject } = useFileSystemProject()
  tryRestoreProject()
})

onMounted(() => {
  const { register, unregister: _unregister } = useShortcuts()
  const { undo, redo } = useUndoRedo()
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()

  register({ id: 'help.shortcuts', keys: ['?'], description: '开启快捷键帮助', scope: 'global', handler: () => { window.dispatchEvent(new CustomEvent('ws-open-shortcut-help')) } })
  register({ id: 'sidebar.toggle', keys: ['ctrl', 'b'], description: '切换侧边栏', scope: 'global', handler: () => uiStore.toggleSidebar() })
  register({ id: 'search.open', keys: ['ctrl', 'k'], description: '全局搜索', scope: 'global', handler: () => { searchOpen.value = true } })
  register({ id: 'settings.open', keys: ['ctrl', ','], description: '打开设置', scope: 'global', handler: () => { window.dispatchEvent(new CustomEvent('ws-open-settings')) } })
  // 空间切换交统一入口（shellSwitch）：壳级双窗互斥切换（显示 dsh 窗、隐本窗）；
  // 方向固定「进入 Agent 空间」（本页恒为工作台窗）。无壳桥（浏览器预览）仅警告。
  register({ id: 'shell.toggle', keys: ['ctrl', 'tab'], description: '进入 Agent 空间', scope: 'global', preventDefault: true, handler: () => { switchShell('space') } })
  // D2-b2：project.manager（Ctrl+Shift+P 打开目录建项目）随同源模型退役——项目在 dsh 侧管理
  register({ id: 'global.undo', keys: ['ctrl', 'z'], description: '撤销', scope: 'global', handler: () => undo(entityStore, relationStore), preventDefault: true })
  register({ id: 'global.redo', keys: ['ctrl', 'y'], description: '重做', scope: 'global', handler: () => redo(entityStore, relationStore), preventDefault: true })
  register({ id: 'global.redo-alt', keys: ['ctrl', 'shift', 'z'], description: '重做(备选)', scope: 'global', handler: () => redo(entityStore, relationStore), preventDefault: true })
  register({ id: 'global.undoHistory', keys: ['ctrl', 'alt', 'z'], description: '撤销历史面板', scope: 'global', handler: () => { undoHistoryOpen.value = !undoHistoryOpen.value } })

  const { saveToFolder } = useFileSystemProject()
  register({ id: 'project.save', keys: ['ctrl', 's'], description: '导出到文件夹', scope: 'global', handler: () => { saveToFolder() }, preventDefault: true })

  // 视图顺序切换（2026-09-28 用户拍板，替代失效的数字键）：Ctrl+↑/↓ 循环切换。
  // 数字键失效根因 = for 循环在 setup 时展开，树异步装载前 views 为空 → 循环 0 次从未注册；
  // 新实现 handler 内动态读 store（引用同一实例），注册时机不再敏感。
  const switchViewBy = (delta: number) => {
    const views = pluginStore.views
    if (views.length === 0) return
    const idx = views.findIndex(v => v.id === uiStore.currentView)
    const next = ((idx === -1 ? 0 : idx + delta) + views.length) % views.length
    const v = views[next]
    if (v) { uiStore.setView(v.id); uiStore.viewComponent = v.component }
  }
  register({ id: 'view.switch.next', keys: ['ctrl', 'down'], description: '切换到下一个视图', scope: 'global', handler: () => switchViewBy(1), preventDefault: true })
  register({ id: 'view.switch.prev', keys: ['ctrl', 'up'], description: '切换到上一个视图', scope: 'global', handler: () => switchViewBy(-1), preventDefault: true })
})

watch(() => uiStore.currentView, (newView, oldView) => {
  if (newView && newView !== oldView) {
    notifyViewSwitch(newView)
  }
})

async function onRedoFromHistory(indices: number[]) {
  const { redo } = useUndoRedo()
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()

  if (!settingsStore.multiStepRedo) {
    await redo(entityStore, relationStore)
    return
  }

  const sorted = [...indices].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; i++) {
    await redo(entityStore, relationStore)
  }
}
</script>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  contain: layout style;
}
.shell-body {
  display: flex;
  flex: 1;
  overflow: hidden;
  /* 三区双线：shell 作为区域画布，padding 提供各圆角块到边缘的缝隙 */
  position: relative;
  padding: var(--region-pad, 8px);
  background: var(--bg-app);
}
/* sidebar-right 模式:Sidebar 用 right:0 定位,ViewContainer 用 margin-right 占位 */
/* order 规则已移除:Sidebar 脱离 flex 文档流后,ViewContainer 是唯一 flex 子元素,order 无意义 */
</style>
