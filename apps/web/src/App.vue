<template>
  <n-config-provider :theme-overrides="naiveThemeOverrides" abstract>
    <BootErrorScreen v-if="uiStore.bootState === 'error'" />
    <SplashScreen v-else-if="showSplash" />
    <n-dialog-provider v-if="uiStore.bootState !== 'error'">
      <n-message-provider>
        <!--
          ⏳ P3 迁移批次（渐进式，每批独立验证可回滚）：
          - P3-W2 ✅ Shell 布局（MenuBar / SidebarV2 / WsConfirmDialog / Companion / AppMessageHandler）
          - P3-W3 ✅ governor 启动编排 + 官方插件（23/27）
          - P3-W5 ✅ AgentSpace 平级切换（currentShell === 'space' → AgentSpace；group-chat 裁剪）
          - P3-W4 ⏳ 业务弹窗恢复（Trash/Settings/Theme/SmartFill/ProjectSwitcher 等）
        -->
        <AgentSpace v-if="uiStore.currentShell === 'space'" />
        <template v-else>
          <Shell />
        </template>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, provide } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider, type GlobalThemeOverrides } from 'naive-ui'
import SplashScreen from './ui/boot/SplashScreen.vue'
import BootErrorScreen from './ui/boot/BootErrorScreen.vue'
import Shell from './ui/layout/Shell.vue'
import AgentSpace from './space/AgentSpace.vue'
import { useUIStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTheme } from './composables/useTheme'
import { provideGlobalSelection, SelectionKey } from '@worldsmith/plugin-sdk'
import { provideAgentUiDeps } from '@worldsmith/shared-composables/agent/deps'
import { usePersonaFont } from './space/composables/usePersonaFont'
import { useActivityLog } from './space/composables/useActivityLog'
import { replaceFontSpans } from './composables/fontSpanParser'
import { useFontStore } from './stores/fontStore'
import AvatarBadge from './ui/AvatarBadge.vue'
import { initGovernor } from './governor'
import { coreModules } from './governor/bootstrap'

const { buildNaiveThemeOverrides, currentThemeId } = useTheme()
const uiStore = useUIStore()

/* ── 启动页生命周期 ── */
const showSplash = ref(true)
const bootMountedAt = Date.now()

watch(() => uiStore.bootState, (state) => {
  if (state === 'ready') {
    // SplashScreen 内部先淡出 600ms，700ms 后卸载组件
    setTimeout(() => { showSplash.value = false }, 700)
  }
})

const naiveThemeOverrides = ref<GlobalThemeOverrides>(buildNaiveThemeOverrides() as GlobalThemeOverrides)

watch(currentThemeId, () => {
  naiveThemeOverrides.value = buildNaiveThemeOverrides() as GlobalThemeOverrides
})

const settingsStore = useSettingsStore()
watch(() => settingsStore.detailPanelPosition, (pos) => {
  document.documentElement.dataset.detailPanelSide = pos
}, { immediate: true })

/* ── 全局选中状态（provide/inject）── */
const globalSelection = provideGlobalSelection()
provide(SelectionKey, globalSelection)

/* ── Agent UI 依赖注入（P5-5.3：共享组件 bubbles 解耦 Web 端资源）── */
const personaFont = usePersonaFont()
const activityLog = useActivityLog()
const fontStore = useFontStore()
provideAgentUiDeps({
  fontFamily: personaFont.fontFamily,
  enterAnimation: personaFont.enterAnimation,
  fontPrefs: computed(() => fontStore.prefs.agent),
  persona: personaFont.profile,
  activityLogs: computed(() => activityLog.logs.value),
  replaceFontSpans,
  AvatarBadge,
})

/* ── 调控器初始化（P3-W3：接管启动编排）── */
// 在 setup 顶层创建 governor 单例，注册所有核心模块
const governor = initGovernor({
  verbose: import.meta.env.MODE === 'development',
})
governor.registerAll(coreModules)

onMounted(async () => {
  try {
  /** 调控器启动：按 priority + 依赖拓扑自动激活所有模块（分级降级策略见文档），详细见 docs/details/注释/web/App.md */
  const report = await governor.boot()

  if (report.hasCriticalFailure) {
    console.error('[App] 关键模块启动失败:', report.failed)
    // critical 失败：进入错误页，不继续启动
    const failedModules = report.failed.map(f => ({
      id: f.id,
      name: governor.getModule(f.id)?.name || f.id,
      error: f.error,
    }))
    const skippedModules = report.skipped.map(s => ({
      id: s.id,
      reason: s.reason,
    }))
    uiStore.markBootError(failedModules, skippedModules)
    return
  }

  if (report.failed.length > 0) {
    console.warn('[App] 启动失败的模块:', report.failed)
  }
  if (report.skipped.length > 0) {
    console.info('[App] 跳过的模块（环境不匹配）:', report.skipped)
  }

  /* ── 启动就绪：通知 SplashScreen 淡出（保证最低展示 800ms）── */
  const elapsed = Date.now() - bootMountedAt
  setTimeout(() => uiStore.markReady(), Math.max(0, 800 - elapsed))

  } catch (err) {
    console.warn('[App]', err)
    // 出错也要释放 splash，避免卡死在启动页
    uiStore.markReady()
  }
})
</script>

<style>
/* ── 实体详情面板左右位置切换 ── */
[data-detail-panel-side="left"] .detail-panel {
  right: auto !important;
  left: 0 !important;
  border-left: none !important;
  border-right: 1px solid var(--glass-border, var(--color-border, var(--border))) !important;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3) !important;
}
[data-detail-panel-side="left"] .detail-panel .resize-handle-left {
  left: auto !important;
  right: 0 !important;
}
[data-detail-panel-side="left"] .detail-panel.ws-detail-slide-enter-from,
[data-detail-panel-side="left"] .detail-panel.ws-detail-slide-leave-to {
  transform: translateX(-100%) !important;
}
[data-detail-panel-side="left"] .detail-panel.slide-enter-from,
[data-detail-panel-side="left"] .detail-panel.slide-leave-to {
  transform: translateX(-100%) !important;
}
</style>
