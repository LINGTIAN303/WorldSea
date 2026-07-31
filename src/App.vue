<template>
  <n-config-provider :theme-overrides="naiveThemeOverrides" abstract>
    <BootErrorScreen v-if="uiStore.bootState === 'error'" />
    <SplashScreen v-else-if="showSplash" />
    <n-dialog-provider v-if="uiStore.bootState !== 'error'">
      <n-message-provider>
        <AppMessageHandler>
          <AgentSpace v-if="uiStore.currentShell === 'space'" />
          <template v-else>
            <Shell />
            <GlobalCaretIndicator />
          </template>
        </AppMessageHandler>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, provide } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider, type GlobalThemeOverrides } from 'naive-ui'
import Shell from './ui/layout/Shell.vue'
import SplashScreen from './ui/boot/SplashScreen.vue'
import BootErrorScreen from './ui/boot/BootErrorScreen.vue'
import AgentSpace from './space/AgentSpace.vue'
import { GlobalCaretIndicator } from '@worldsmith/ui-kit'
import AppMessageHandler from './ui/companion/AppMessageHandler.vue'
import { useUIStore } from './stores/uiStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTheme } from './composables/useTheme'
import { provideGlobalSelection, SelectionKey } from '@worldsmith/plugin-sdk'
import { useArchiveTriggers } from './memory-archive'
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

/* ── 记忆库归档触发器（P3-2-4 新增）── */
// 在 setup 顶层调用以正确注册 onUnmounted，start() 在 onMounted 中调用
const archiveTriggers = useArchiveTriggers()

/* ── 调控器初始化 ── */
// 在 setup 顶层创建 governor 单例，注册所有核心模块
const governor = initGovernor({
  verbose: import.meta.env.MODE === 'development',
})
governor.registerAll(coreModules)

onMounted(async () => {
  try {
  /* ── 调控器启动：按 priority + 依赖拓扑自动激活所有模块 ──
   *
   * 替代原硬编码启动流程：
   * - critical: 项目空间/WASM 检测/插件预注册
   * - normal: 官方插件/关系初始化/Facet 迁移/自定义模块/导航监听
   * - lazy: 字体/记忆库/自动清理
   *
   * 分级降级策略：
   * - critical 失败 → hasCriticalFailure=true，显示错误页
   * - normal 失败 → 记录但继续
   * - lazy 失败 → 静默
   */
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
    return  // 不执行后续的 archiveTriggers.start() 和 markReady()
  }

  if (report.failed.length > 0) {
    console.warn('[App] 启动失败的模块:', report.failed)
  }
  if (report.skipped.length > 0) {
    console.info('[App] 跳过的模块（环境不匹配）:', report.skipped)
  }

  /* ── 记忆库归档触发器启动 ──
   * useArchiveTriggers 依赖 Vue 的 onUnmounted，必须在组件 setup 上下文中创建，
   * 因此不放入 governor 模块，而是在 governor.boot() 后手动启动。
   */
  archiveTriggers.start()

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
/* Global styles migrated to design-tokens/component.css */

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
