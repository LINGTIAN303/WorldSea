<template>
  <div class="shell">
    <TitleBar />
    <WelcomeOverlay />
    <div id="main-content" tabindex="-1" class="shell-body" :class="{ 'sidebar-right': settingsStore.sidebarPosition === 'right', 'sprout-nav-dual': uiStore.sproutNavMode === 'dual' }">
      <Sidebar />
      <ViewContainer />
    </div>
    <Toast />
    <DialogContainer />
    <WsConfirmDialog />
    <WsAskDialog />
    <!-- 快捷键系统 L0 显示面（帮助/撤销历史——redo 回调与 toggle 语义耦合快捷键系统，不插件化） -->
    <ShortcutHelpModal :show="shortcutHelpOpen" @close="shortcutHelpOpen = false" />
    <UndoHistoryPanel :show="undoHistoryOpen" @close="undoHistoryOpen = false" @redo="onRedoFromHistory" />
    <!-- 插件贡献的全局覆盖层（批2/3/5/6）：全部业务弹窗由 world 树插件经 registerOverlay 登记，OverlayHost 渲染 -->
    <OverlayHost />
  </div>
</template>

<script setup lang="ts">
import { ref, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import TitleBar from './TitleBar.vue'
import Sidebar from './sidebar/SidebarHost.vue'
import { visibleViewsInSidebarOrder } from './sidebar/viewOrder'
import { Toast, DialogContainer, ViewContainer } from '@worldsea/ui-kit'
import WsConfirmDialog from '../WsConfirmDialog.vue'
import WsAskDialog from '../WsAskDialog.vue'

const WelcomeOverlay = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.WelcomeOverlay))
const ShortcutHelpModal = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.ShortcutHelpModal))
const UndoHistoryPanel = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.UndoHistoryPanel))
import { useShortcuts, useUndoRedo, useGlobalEvents } from '@worldsea/ui-kit'
import { usePluginStore, useDirtyTracker, useEntityStore, useRelationStore, entitySchemaRegistry, relationshipRegistry, useUIStore, useSettingsStore } from '@worldsea/entity-core'
import { useFileSystemProject } from '@worldsea/entity-core/composables'
// D2-b2：useProjectSwitcher 引用已随「打开目录建项目」入口退役移除（项目切换在 ProjectSwitcher 下拉）
import { switchShell } from '@/composables/shellSwitch'

const shortcutHelpOpen = ref(false)
const undoHistoryOpen = ref(false)

// 业务弹窗已全部插件化（批2 data-tools / 批3 theme-editor+entity-tools / 批5 settings /
// 批6 search·import-export·batch-edit·templates·version-history·doc-export）——
// Shell 不再直挂任何业务弹窗；本文件只剩 L0 骨架职责（布局/快捷键/全局事件接线）。

const OverlayHost = defineAsyncComponent(() => import('@/shell/OverlayHost.vue'))

// ws-open-search / import-export / batch-edit / template / version / doc-export（批6）与
// 批2/3/5 全部迁移面均由 OverlayHost 按 `ws-open-<id>` 约定消费
// D2-b2（2026-09-28）：项目 = dsh 工作区（同源）——「打开目录建项目」入口与 ws-open-project-manager
// 事件随 useProjectSwitcher 的入口删除一并退役；项目新建/管理在 Agent 空间 dsh 界面进行。

const pluginStore = usePluginStore()
const uiStore = useUIStore()
const settingsStore = useSettingsStore()

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
  // 契约单一口径：{ entityType, entityId }（2026-10-08 全链统一；旧 view/type 读法已撤）
  const { entityType, entityId } = detail
  const schema = entitySchemaRegistry.get(entityType)
  const pluginId = schema?.pluginId
  const targetView = pluginStore.views.find(v => v.pluginId === pluginId)
  if (targetView) {
    uiStore.setView(targetView.id)
    uiStore.viewComponent = targetView.component
  }
  if (entityId) {
    // 双通道：挂起位兜底跨视图（新视图挂载晚于本事件）+ 即时事件通道响应当前已挂载视图
    uiStore.selectEntity(entityId)
    window.dispatchEvent(new CustomEvent('ws-select-entity', { detail: { entityId } }))
  }
}

const { on: onGlobalEvent } = useGlobalEvents()

// 批2/3/5/6 迁移面的 ws-open-* 事件均由 OverlayHost 消费（search/import-export/batch-edit/
// template/version/doc-export/trash/artifacts/consistency/theme-editor/custom-rel-type/entity-template/settings）
onGlobalEvent('ws-open-shortcut-help', () => { shortcutHelpOpen.value = true })
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
  register({ id: 'search.open', keys: ['ctrl', 'k'], description: '全局搜索', scope: 'global', handler: () => { window.dispatchEvent(new CustomEvent('ws-open-search')) } })
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
  // 2026-10-01 修「切得太多/乱跳」：改用**侧栏同一份可见顺序**（viewOrder 单一口径）——
  // 旧实现走 pluginStore.views 注册序且不过滤隐藏芽，按键后常跳到侧栏看不见的位置。
  const switchViewBy = (delta: number) => {
    const views = visibleViewsInSidebarOrder()
    if (views.length === 0) return
    const idx = views.findIndex(v => v.id === uiStore.currentView)
    const next = ((idx === -1 ? 0 : idx + delta) + views.length) % views.length
    const v = views[next]
    if (v) { uiStore.setView(v.id); uiStore.viewComponent = v.component }
  }
  register({ id: 'view.switch.next', keys: ['ctrl', 'down'], description: '切换到下一个视图', scope: 'global', handler: () => switchViewBy(1), preventDefault: true })
  register({ id: 'view.switch.prev', keys: ['ctrl', 'up'], description: '切换到上一个视图', scope: 'global', handler: () => switchViewBy(-1), preventDefault: true })
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
/* R3-b 双栏导航组：覆盖侧栏宽度变量，Sidebar 与 ViewContainer 共用同一让位口径 */
.shell-body.sprout-nav-dual {
  --layout-sidebar-width: var(--layout-sidebar-dual-width, 330px);
}
</style>
