<script setup lang="ts">
import { onMounted } from 'vue'
import Shell from './ui/layout/Shell.vue'
import AgentSpace from './space/AgentSpace.vue'
import { useUIStore } from './stores/uiStore'
import { useTheme } from './components/ui/useTheme'
import { bootstrapPlugins } from './plugins/bootstrap'
import { useProjectSwitcher } from './composables/useProjectSwitcher'
import { useSystemBridge } from './composables/useSystemBridge'

// 主题初始化：Shell 与 AgentSpace 共用（三态；components/ui/useTheme 已内置
// 跟随系统——preference 'system' 默认态 + matchMedia 实时监听，无需额外实现）
const { theme: themeMode, apply: applyTheme } = useTheme()
// 系统层桥：托盘事件监听 + 状态同步（App 启动时 setup，幂等）
const { setup: setupSystemBridge } = useSystemBridge()

const uiStore = useUIStore()
const projectSwitcher = useProjectSwitcher()

onMounted(async () => {
  // 应用初始主题（html data-theme 由此建立；apply 为同步函数，需传入当前主题模式）
  applyTheme(themeMode.value)
  // 项目系统初始化 + projectDir 绑定（必须在 bootstrapPlugins 之前：
  // 插件初始化 / Store loadAll 依赖 FileStorageBackend 已就绪，否则 isReady=false
  // 会降级到不可用的 TauriStorageBackend，导致 cmd_get_all_entities 等 IPC 失败）
  try {
    await projectSwitcher.initialize()
  } catch (err) {
    console.error('[App] 项目系统初始化失败:', err)
  }
  // Agent 工作台视图已退役（2026-08-09）：能力迁入 AgentSpace 执行面板，
  // Shell 仅承载官方插件视图；默认进入 AgentSpace（currentShell 持久化）
  // 启动已迁移插件（Phase C：注册视图/实体类型）
  await bootstrapPlugins()
  // bootstrap 会在无视图选中时兜底切到首个插件视图
  // 系统层桥初始化：托盘事件监听 + 最近项目同步（异步，不阻塞启动）
  void setupSystemBridge()
})
</script>

<template>
  <!-- 平级切换：space=Agent 聊天空间 / workbench=插件工作台（uiStore.currentShell 持久化） -->
  <AgentSpace v-if="uiStore.currentShell === 'space'" />
  <Shell v-else />
</template>

<style>
/* App.vue 根样式：Shell 占满窗口 */
html, body, #app {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>
