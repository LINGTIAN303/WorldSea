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
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
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
/** 项目=目录（2026-09-03）：打开文件夹即打开项目（替代原项目管理弹窗 / ws-open-project-manager 事件 / Ctrl+Shift+P） */
function openProjectFolderDialog() {
  const { openProjectFromDialog } = useProjectSwitcher()
  return openProjectFromDialog()
}

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
// 壳感知弹窗事件（2026-09-06）：设置/帮助来源（快捷键 handler / AppMenu / 托盘）统一 dispatch
// 全局事件，两壳各监听同名事件、仅在自己壳激活时打开（AgentSpace 侧对称监听）——
// 修复「Agent 空间按 ? / Ctrl+, 弹窗开在隐藏的 Shell 壳里」。
onGlobalEvent('ws-open-settings', () => { if (uiStore.currentShell !== 'space') onOpenSettings() })
onGlobalEvent('ws-open-shortcut-help', () => { if (uiStore.currentShell !== 'space') shortcutHelpOpen.value = true })
onGlobalEvent('ws-open-theme-editor', onOpenThemeEditor)
onGlobalEvent('ws-open-custom-rel-type', onOpenCustomRelType)
onGlobalEvent('ws-open-entity-template', onOpenEntityTemplate)
onGlobalEvent('ws-open-project-manager', () => { void openProjectFolderDialog() })
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
  register({ id: 'shell.toggle', keys: ['ctrl', 'tab'], description: '切换 Agent 空间 ⇄ 工作台', scope: 'global', preventDefault: true, handler: () => { uiStore.setShell(uiStore.currentShell === 'workbench' ? 'space' : 'workbench') } })
  register({ id: 'project.manager', keys: ['ctrl', 'shift', 'p'], description: '打开项目（选择目录）', scope: 'global', handler: () => { void openProjectFolderDialog() } })
  register({ id: 'global.undo', keys: ['ctrl', 'z'], description: '撤销', scope: 'global', handler: () => undo(entityStore, relationStore), preventDefault: true })
  register({ id: 'global.redo', keys: ['ctrl', 'y'], description: '重做', scope: 'global', handler: () => redo(entityStore, relationStore), preventDefault: true })
  register({ id: 'global.redo-alt', keys: ['ctrl', 'shift', 'z'], description: '重做(备选)', scope: 'global', handler: () => redo(entityStore, relationStore), preventDefault: true })
  register({ id: 'global.undoHistory', keys: ['ctrl', 'alt', 'z'], description: '撤销历史面板', scope: 'global', handler: () => { undoHistoryOpen.value = !undoHistoryOpen.value } })

  const { saveToFolder } = useFileSystemProject()
  register({ id: 'project.save', keys: ['ctrl', 's'], description: '导出到文件夹', scope: 'global', handler: () => { saveToFolder() }, preventDefault: true })

  for (let i = 0; i < Math.min(pluginStore.views.length, 9); i++) {
    const idx = i
    register({
      id: `view.switch.${idx}`,
      keys: [String(idx + 1)],
      description: `切换到 ${pluginStore.views[idx]?.label || '视图' + (idx+1)}`,
      scope: 'global',
      handler: () => {
        // 壳感知（2026-09-06）：Agent 空间下数字键交给 space 层（右栏 Tab 切换），
        // 不隐形切换被 v-show 隐藏的 workbench 视图
        if (uiStore.currentShell === 'space') return
        const v = pluginStore.views[idx]
        if (v) { uiStore.setView(v.id); uiStore.viewComponent = v.component }
      },
    })
  }
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
