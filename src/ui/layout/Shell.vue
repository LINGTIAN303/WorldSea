<template>
  <div class="shell">
    <WelcomeOverlay />
    <MenuBar />
    <div class="shell-body" :class="{ 'sidebar-right': settingsStore.sidebarPosition === 'right' }">
      <Sidebar />
      <ViewContainer />
    </div>
    <GlobalSearch :show="searchOpen" @close="searchOpen = false" />
    <ImportExportModal :show="importExportOpen" @close="importExportOpen = false" />
    <Toast />
    <DialogContainer />
    <WsConfirmDialog />
    <BatchEditModal :show="batchEditOpen" @close="batchEditOpen = false" />
    <TemplateManager :show="templateOpen" @close="templateOpen = false" />
    <VersionHistory :show="versionOpen" @close="versionOpen = false" />
    <TrashPanel :show="trashOpen" @close="trashOpen = false" />
    <ConsistencyReportPanel :show="consistencyOpen" @close="consistencyOpen = false" />
    <DocExport :show="docOpen" @close="docOpen = false" />
    <SettingsDialog :show="settingsOpen" @close="settingsOpen = false" />
    <ThemeEditor :show="themeEditorOpen" @close="themeEditorOpen = false" />
    <LayoutManager :show="layoutMgrOpen" @close="layoutMgrOpen = false" />
    <ShortcutHelpModal :show="shortcutHelpOpen" @close="shortcutHelpOpen = false" />
    <UndoHistoryPanel :show="undoHistoryOpen" @close="undoHistoryOpen = false" @redo="onRedoFromHistory" />
    <CustomRelationTypeDialog :show="customRelTypeOpen" @close="customRelTypeOpen = false" />
    <EntityTemplateDialog :show="entityTemplateOpen" @close="entityTemplateOpen = false" />
    <ProjectSwitcherDialog :show="projectManagerOpen" @close="projectManagerOpen = false" />
    <InfoPanel />
    <CompanionNotification :notifications="companionNotifications" :session-memory="companionSessionMemory" @dismiss="dismissNotification" @pin="pinNotification" @unpin="unpinNotification" />
    <AgentOverlay />
    <SmartFillChat :visible="smartFillChat.visible.value" :context="smartFillChat.context.value" :loading="smartFillChat.loading.value" :messages="smartFillChat.messages.value" @close="smartFillChat.close" @send="smartFillChat.sendMessage" />
    <SmartFillChatTrigger :visible="textSelection.triggerVisible.value" :rect="textSelection.triggerRect.value" @click="onSmartFillTriggerClick" />
    <SmartFillContextMenu
      :visible="contextMenu.visible.value"
      :x="contextMenu.x.value"
      :y="contextMenu.y.value"
      :entity-type="contextMenu.entityType.value"
      :entity-id="contextMenu.entityId.value"
      :entity-name="contextMenu.entityName.value"
      @discuss="onContextMenuDiscuss"
      @close="contextMenu.close"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue'
import MenuBar from './MenuBar.vue'
import Sidebar from './sidebar/SidebarV2.vue'
import { Toast, DialogContainer, ViewContainer } from '@worldsmith/ui-kit'
import WsConfirmDialog from '../WsConfirmDialog.vue'

const WelcomeOverlay = defineAsyncComponent(() => import('@worldsmith/ui-kit').then(m => m.WelcomeOverlay))
const GlobalSearch = defineAsyncComponent(() => import('@worldsmith/ui-kit').then(m => m.GlobalSearch))
const ImportExportModal = defineAsyncComponent(() => import('../data/ImportExportModal.vue'))
import { BatchEditModal } from '@worldsmith/plugin-sdk'
const TemplateManager = defineAsyncComponent(() => import('@worldsmith/ui-kit').then(m => m.TemplateManager))
const VersionHistory = defineAsyncComponent(() => import('@worldsmith/ui-kit').then(m => m.VersionHistory))
const TrashPanel = defineAsyncComponent(() => import('../data/TrashPanel.vue'))
const ConsistencyReportPanel = defineAsyncComponent(() => import('../data/ConsistencyReportPanel.vue'))
const DocExport = defineAsyncComponent(() => import('../data/DocExport.vue'))
const SettingsDialog = defineAsyncComponent(() => import('../settings/SettingsDialog.vue'))
const ThemeEditor = defineAsyncComponent(() => import('../../components/theme-editor/ThemeEditor.vue'))
const LayoutManager = defineAsyncComponent(() => import('@worldsmith/ui-kit').then(m => m.LayoutManager))
const ShortcutHelpModal = defineAsyncComponent(() => import('../settings/ShortcutHelpModal.vue'))
const UndoHistoryPanel = defineAsyncComponent(() => import('@worldsmith/ui-kit').then(m => m.UndoHistoryPanel))
const CustomRelationTypeDialog = defineAsyncComponent(() => import('../entity/CustomRelationTypeDialog.vue'))
const EntityTemplateDialog = defineAsyncComponent(() => import('../entity/EntityTemplateDialog.vue'))
const ProjectSwitcherDialog = defineAsyncComponent(() => import('../project/ProjectSwitcherDialog.vue'))
const InfoPanel = defineAsyncComponent(() => import('@worldsmith/ui-kit').then(m => m.InfoPanel))
const AgentOverlay = defineAsyncComponent(() => import('../../agent/AgentOverlay.vue'))
const SmartFillChat = defineAsyncComponent(() => import('../smart-fill/SmartFillChat.vue'))
const SmartFillChatTrigger = defineAsyncComponent(() => import('../smart-fill/SmartFillChatTrigger.vue'))
const SmartFillContextMenu = defineAsyncComponent(() => import('../smart-fill/SmartFillContextMenu.vue'))
import { useShortcuts, useUndoRedo, useGlobalEvents, useTextSelection, useSmartFillContextMenu } from '@worldsmith/ui-kit'
import {
  usePluginStore,
  useDirtyTracker,
  useEntityStore,
  useRelationStore,
  entitySchemaRegistry,
  relationshipRegistry,
  useUIStore,
  useSettingsStore,
} from '@worldsmith/entity-core'
import { useFileSystemProject } from '@worldsmith/entity-core/composables'
import { useSmartFillChat } from '../../composables/useSmartFillChat'
import CompanionNotification from '../companion/CompanionNotification.vue'
import { useCompanionMode } from '../../composables/useCompanionMode'

const searchOpen = ref(false)
const importExportOpen = ref(false)
const batchEditOpen = ref(false)
const templateOpen = ref(false)
const versionOpen = ref(false)
const trashOpen = ref(false)
const consistencyOpen = ref(false)
const docOpen = ref(false)
const settingsOpen = ref(false)
const themeEditorOpen = ref(false)
const layoutMgrOpen = ref(false)
const shortcutHelpOpen = ref(false)
const undoHistoryOpen = ref(false)
const customRelTypeOpen = ref(false)
const entityTemplateOpen = ref(false)
const projectManagerOpen = ref(false)



function onOpenSearch() { searchOpen.value = true }
function onOpenImportExport() { importExportOpen.value = true }
function onOpenBatchEdit() { batchEditOpen.value = true }
function onOpenTemplate() { templateOpen.value = true }
function onOpenVersion() { versionOpen.value = true }
function onOpenTrash() { trashOpen.value = true }
function onOpenConsistency() { consistencyOpen.value = true }
function onOpenDocExport() { docOpen.value = true }
function onOpenLayoutMgr() { layoutMgrOpen.value = true }
function onOpenSettings() { settingsOpen.value = true }
function onOpenThemeEditor() { themeEditorOpen.value = true }
function onOpenCustomRelType() { customRelTypeOpen.value = true }
function onOpenEntityTemplate() { entityTemplateOpen.value = true }

const pluginStore = usePluginStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const { notifications: companionNotifications, dismissNotification, pinNotification, unpinNotification, notifyViewSwitch, sessionMemory: companionSessionMemory } = useCompanionMode()

/* ── Smart Fill: 文本选择监听 + 对话小窗（全局生效） ── */
const textSelection = useTextSelection()
const smartFillChat = useSmartFillChat()
const contextMenu = useSmartFillContextMenu()

function onSmartFillTriggerClick() {
  if (textSelection.selection.value) {
    smartFillChat.openFromSelection(textSelection.selection.value)
  }
  textSelection.dismissTrigger()
}

function onSmartFillChatOpen(e: Event) {
  const detail = (e as CustomEvent).detail
  smartFillChat.open(detail)
}

onMounted(() => {
  window.addEventListener('worldsmith:smart-fill:chat-open', onSmartFillChatOpen)
  // 注册 beforeunload 防丢失提醒
  const { setupBeforeUnload } = useDirtyTracker()
  const cleanupBeforeUnload = setupBeforeUnload()
  onUnmounted(() => cleanupBeforeUnload())
  // 加载持久化的自定义关系类型
  relationshipRegistry.loadCustomTypes()
})

onUnmounted(() => {
  window.removeEventListener('worldsmith:smart-fill:chat-open', onSmartFillChatOpen)
})

function onContextMenuDiscuss(ctx: { entityType?: string; entityId?: string; entityName?: string }) {
  smartFillChat.open(ctx)
  contextMenu.close()
}

watch(() => uiStore.currentView, (newView, oldView) => {
  if (newView && newView !== oldView) {
    notifyViewSwitch(newView)
  }
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
onGlobalEvent('ws-open-trash', onOpenTrash)
onGlobalEvent('ws-open-consistency', onOpenConsistency)
onGlobalEvent('ws-open-doc-export', onOpenDocExport)
onGlobalEvent('ws-open-layout-mgr', onOpenLayoutMgr)
onGlobalEvent('ws-open-settings', onOpenSettings)
onGlobalEvent('ws-open-theme-editor', onOpenThemeEditor)
onGlobalEvent('ws-open-custom-rel-type', onOpenCustomRelType)
onGlobalEvent('ws-open-entity-template', onOpenEntityTemplate)
onGlobalEvent('ws-open-project-manager', () => { projectManagerOpen.value = true })
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

  register({ id: 'help.shortcuts', keys: ['?'], description: '开启快捷键帮助', scope: 'global', handler: () => { shortcutHelpOpen.value = true } })
  register({ id: 'sidebar.toggle', keys: ['ctrl', 'b'], description: '切换侧边栏', scope: 'global', handler: () => uiStore.toggleSidebar() })
  register({ id: 'search.open', keys: ['ctrl', 'k'], description: '全局搜索', scope: 'global', handler: () => { searchOpen.value = true } })
  register({ id: 'settings.open', keys: ['ctrl', ','], description: '打开设置', scope: 'global', handler: () => { settingsOpen.value = true } })
  register({ id: 'project.manager', keys: ['ctrl', 'shift', 'p'], description: '项目管理', scope: 'global', handler: () => { projectManagerOpen.value = true } })
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
        const v = pluginStore.views[idx]
        if (v) { uiStore.setView(v.id); uiStore.viewComponent = v.component }
      },
    })
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
  /* 性能优化:为 Sidebar position:absolute 提供定位上下文 */
  position: relative;
}
/* sidebar-right 模式:Sidebar 用 right:0 定位,ViewContainer 用 margin-right 占位 */
/* order 规则已移除:Sidebar 脱离 flex 文档流后,ViewContainer 是唯一 flex 子元素,order 无意义 */
</style>
