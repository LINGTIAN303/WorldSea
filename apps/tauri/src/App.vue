<script setup lang="ts">
import { onMounted } from 'vue'
import Shell from './ui/layout/Shell.vue'
import AgentWorkspace from './agent/AgentWorkspace.vue'
import { usePluginStore } from '@worldsmith/entity-core'
import { useUIStore } from './stores/uiStore'
import { useTheme } from './components/ui/useTheme'
import { bootstrapPlugins } from './plugins/bootstrap'
import { useProjectSwitcher } from './composables/useProjectSwitcher'

// 主题初始化：Shell 与 AgentWorkspace 共用（三态）
const { theme: themeMode, apply: applyTheme } = useTheme()

const pluginStore = usePluginStore()
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
  // 注册 Agent 工作台视图到 Shell 侧栏（首项，默认选中）
  pluginStore.registerView({
    id: 'agent',
    label: 'Agent',
    icon: 'lightning',
    component: AgentWorkspace,
    // 内置工作台视图不挂插件归属（pluginId）：否则 sidebar 会被 isActive 过滤掉，
    // 用户切换插件视图后将无法回到 Agent（Phase D 修复）
  })
  // 确保 agent 进入侧栏顺序且为首项
  uiStore.ensureViewInOrder('agent')
  uiStore.setView('agent')
  uiStore.viewComponent = AgentWorkspace
  // 启动已迁移插件（Phase C：注册视图/实体类型，追加到 agent 之后）
  await bootstrapPlugins()
  // bootstrap 可能在无视图选中时兜底切到首个插件视图；agent 是内置默认，恢复为 agent
  if (pluginStore.views.length > 0) {
    uiStore.setView('agent')
    uiStore.viewComponent = AgentWorkspace
  }
})
</script>

<template>
  <Shell />
</template>

<style>
/* App.vue 根样式：Shell 占满窗口 */
html, body, #app {
  height: 100%;
  margin: 0;
  overflow: hidden;
}
</style>
