<template>
  <div class="shell">
    <!-- 画布背景层：全窗口底图，位于所有区域之下（v2 五目标之 canvas） -->
    <BackgroundLayer target="canvas" />
    <TitleBar />
    <WelcomeOverlay />
    <div class="shell-content">
      <!-- R4：后台任务（导出到文件夹 / 外部变更同步）统一由注册表驱动，>1s 才出现 -->
      <WsAmbientLine class="shell-ambient" :active="backgroundActive" :label="backgroundLabel" />
      <!-- Task 9：主页/工作台互斥由 ShellSurface 承接（inert/aria-busy 亦由它下发） -->
      <ShellSurface
        :surface="uiStore.surface"
        :inert="switchVisible"
        :busy="switchVisible"
        :workspace-class="{ 'sidebar-right': settingsStore.sidebarPosition === 'right', 'sprout-nav-dual': uiStore.sproutNavMode === 'dual' }"
      >
        <template #home><HomeSurface /></template>
        <template #workspace><Sidebar /><ViewContainer /></template>
      </ShellSurface>
      <WsLoadingOverlay
        :show="switchVisible"
        scope="content"
        title="正在切换项目"
        success-title="切换完成"
        error-title="切换失败"
        :stages="switchStages"
        :current="switchStage"
        :status="switchStatus"
        :target="switchTargetName ? `目标：${switchTargetName}` : ''"
        :error="switchError ?? ''"
        :success-text="switchSuccessText"
        success-detail="可以继续工作"
        error-text="无法完成项目切换"
        @retry="retrySwitch"
        @close="dismissSwitchError"
      />
    </div>
    <Toast />
    <DialogContainer />
    <WsConfirmDialog />
    <WsAskDialog />
    <!-- 自绘文件选择器单例宿主（消费 entity-core FilePickerApi 注入槽的请求队列） -->
    <FilePickerHost />
    <!-- 快捷键系统 L0 显示面（帮助/撤销历史——redo 回调与 toggle 语义耦合快捷键系统，不插件化） -->
    <ShortcutHelpModal :show="shortcutHelpOpen" @close="shortcutHelpOpen = false" />
    <UndoHistoryPanel :show="undoHistoryOpen" @close="undoHistoryOpen = false" @redo="onRedoFromHistory" />
    <!-- 插件贡献的全局覆盖层（批2/3/5/6）：全部业务弹窗由 world 树插件经 registerOverlay 登记，OverlayHost 渲染 -->
    <OverlayHost />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue'
import TitleBar from './TitleBar.vue'
import ShellSurface from './ShellSurface.vue'
import Sidebar from './sidebar/SidebarHost.vue'
import { Toast, DialogContainer, ViewContainer, WsLoadingOverlay, WsAmbientLine, BackgroundLayer, useBackgroundTask, toastWarn } from '@worldsea/ui-kit'
import WsConfirmDialog from '../WsConfirmDialog.vue'
import WsAskDialog from '../WsAskDialog.vue'
import FilePickerHost from '@/components/files/FilePickerHost.vue'
import HomeSurface from '@/ui/home/HomeSurface.vue'
import { useHomeNavigation } from '@/ui/home/useHomeNavigation'
import { useShellViewSwitch } from './useShellViewSwitch'

const WelcomeOverlay = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.WelcomeOverlay))
const ShortcutHelpModal = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.ShortcutHelpModal))
const UndoHistoryPanel = defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.UndoHistoryPanel))
import { useShortcuts, useUndoRedo, useGlobalEvents } from '@worldsea/ui-kit'
import { usePluginStore, useDirtyTracker, useEntityStore, useRelationStore, entitySchemaRegistry, relationshipRegistry, useUIStore, useSettingsStore } from '@worldsea/entity-core'
import { useFileSystemProject } from '@worldsea/entity-core/composables'
// D2-b2：useProjectSwitcher 引用已随「打开目录建项目」入口退役移除（项目切换在 ProjectSwitcher 下拉）
import { switchShell } from '@/composables/shellSwitch'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'

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
const { active: backgroundActive, label: backgroundLabel } = useBackgroundTask()

// 2026-10-23 产品域首页：壳级导航按「表面」收口——ws-navigate 与 Ctrl+↑/↓ 都走首页单点导航口径
const { openWorkspace } = useHomeNavigation()
const switchViewBy = useShellViewSwitch()
/** 工作台专属快捷键守卫：首页（默认表面）下静默不执行，不得改底层视图/数据（设计 §3.4） */
const inWorkspace = () => uiStore.surface === 'workspace'

/** 后台任务失败：非阻断 toast，不弹模态 */
function onBackgroundFailed(e: Event) {
  const detail = (e as CustomEvent).detail ?? {}
  toastWarn(`${detail.label ?? '后台任务'}失败${detail.message ? `：${detail.message}` : ''}`)
}

const {
  switchVisible,
  switchStatus,
  switchStage,
  switchTargetName,
  switchError,
  switchStages,
  retrySwitch,
  dismissSwitchError,
} = useProjectSwitcher()

const switchSuccessText = computed(() => switchTargetName.value ? `${switchTargetName.value} 已就绪` : '已就绪')

onMounted(() => {
  // 注册 beforeunload 防丢失提醒
  const { setupBeforeUnload } = useDirtyTracker()
  const cleanupBeforeUnload = setupBeforeUnload()
  onUnmounted(() => cleanupBeforeUnload())
  // 加载持久化的自定义关系类型
  relationshipRegistry.loadCustomTypes()
  window.addEventListener('ws-background-failed', onBackgroundFailed)
  onUnmounted(() => window.removeEventListener('ws-background-failed', onBackgroundFailed))
})

function onWsNavigate(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail) return
  // 契约单一口径：{ entityType, entityId }（2026-10-08 全链统一；旧 view/type 读法已撤）
  const { entityType, entityId } = detail
  const schema = entitySchemaRegistry.get(entityType)
  const pluginId = schema?.pluginId
  const targetView = pluginStore.views.find(v => v.pluginId === pluginId)
  // 2026-10-23 产品域首页：命中目标视图即交给首页单点导航（设视图/组件、写选中挂起位 +
  // ws-select-entity、切 workspace）；此前只 setView 不切表面，首页搜索选中会被 setView 清掉
  if (targetView) {
    openWorkspace(targetView.id, entityId)
    return
  }
  // 无目标视图（类型未注册/芽未启用）：仅工作台内沿用「当前视图选中」即时通道，不切表面
  if (entityId && uiStore.surface === 'workspace') {
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
  // 2026-10-23 产品域首页：Ctrl+B / 撤销重做 / 撤销历史为工作台专属——首页下静默不执行；
  // 搜索 / 设置 / 帮助 / Agent 空间 / 导出仍全表面可用（设计 §3.4）
  register({ id: 'sidebar.toggle', keys: ['ctrl', 'b'], description: '切换侧边栏', scope: 'global', handler: () => { if (inWorkspace()) uiStore.toggleSidebar() } })
  register({ id: 'search.open', keys: ['ctrl', 'k'], description: '全局搜索', scope: 'global', handler: () => { window.dispatchEvent(new CustomEvent('ws-open-search')) } })
  register({ id: 'settings.open', keys: ['ctrl', ','], description: '打开设置', scope: 'global', handler: () => { window.dispatchEvent(new CustomEvent('ws-open-settings')) } })
  // 空间切换交统一入口（shellSwitch）：壳级双窗互斥切换（显示 dsh 窗、隐本窗）；
  // 方向固定「进入 Agent 空间」（本页恒为工作台窗）。无壳桥（浏览器预览）仅警告。
  register({ id: 'shell.toggle', keys: ['ctrl', 'tab'], description: '进入 Agent 空间', scope: 'global', preventDefault: true, handler: () => { switchShell('space') } })
  // D2-b2：project.manager（Ctrl+Shift+P 打开目录建项目）随同源模型退役——项目在 dsh 侧管理
  register({ id: 'global.undo', keys: ['ctrl', 'z'], description: '撤销', scope: 'global', handler: () => { if (inWorkspace()) undo(entityStore, relationStore) }, preventDefault: true })
  register({ id: 'global.redo', keys: ['ctrl', 'y'], description: '重做', scope: 'global', handler: () => { if (inWorkspace()) redo(entityStore, relationStore) }, preventDefault: true })
  register({ id: 'global.redo-alt', keys: ['ctrl', 'shift', 'z'], description: '重做(备选)', scope: 'global', handler: () => { if (inWorkspace()) redo(entityStore, relationStore) }, preventDefault: true })
  register({ id: 'global.undoHistory', keys: ['ctrl', 'alt', 'z'], description: '撤销历史面板', scope: 'global', handler: () => { if (inWorkspace()) undoHistoryOpen.value = !undoHistoryOpen.value } })

  const { saveToFolder } = useFileSystemProject()
  register({ id: 'project.save', keys: ['ctrl', 's'], description: '导出到文件夹', scope: 'global', handler: () => { saveToFolder() }, preventDefault: true })

  // 视图顺序切换（2026-09-28 用户拍板，替代失效的数字键）：Ctrl+↑/↓ 循环切换。
  // 2026-10-01 修「切得太多/乱跳」：改用**侧栏同一份可见顺序**（viewOrder 单一口径）——
  // 旧实现走 pluginStore.views 注册序且不过滤隐藏芽，按键后常跳到侧栏看不见的位置。
  // 2026-10-23：实现抽到 useShellViewSwitch（首页不生效 + 可直测），注册时机不再敏感。
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
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  contain: layout style;
}
/* 内容区容器：titlebar 之外的全部区域；加载遮罩以它为定位上下文（不盖标题栏） */
.shell-content {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
}
.shell-ambient {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: calc(var(--z-loading) - 1);
}
</style>
