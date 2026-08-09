<script setup lang="ts">
import { onMounted } from 'vue'
import Shell from './ui/layout/Shell.vue'
import AgentSpace from './space/AgentSpace.vue'
import { useUIStore } from './stores/uiStore'
import { useTheme } from './components/ui/useTheme'
import { useTheme as useEntityTheme } from '@worldsmith/entity-core'
import { useGlobalEvents } from '@worldsmith/ui-kit'
import { bootstrapPlugins } from './plugins/bootstrap'
import { useProjectSwitcher } from './composables/useProjectSwitcher'
import { useSystemBridge } from './composables/useSystemBridge'

// 主题初始化：Shell 与 AgentSpace 共用（三态；components/ui/useTheme 已内置
// 跟随系统——preference 'system' 默认态 + matchMedia 实时监听，无需额外实现）
const { theme: themeMode, apply: applyTheme, setMode } = useTheme()
// 系统层桥：托盘事件监听 + 状态同步（App 启动时 setup，幂等）
const { setup: setupSystemBridge } = useSystemBridge()

const uiStore = useUIStore()
const projectSwitcher = useProjectSwitcher()

/**
 * 预设主题切换统一落地（AppearancePanel/ThemeEditor 派发 ws-set-theme）。
 * App.vue 恒挂载（AgentSpace / Shell 平级切换），在此注册保证两种壳都生效。
 * - setTheme(id)：更新 entity-core currentThemeId（active 高亮）+ 应用 Manifest
 * - setMode(mode)：App 壳唯一控制 data-theme（覆盖命名 id，保证明暗自洽）
 * - setUserOverrides：写 --accent 令牌风味（与圆角/密度合并）
 */
const { setTheme: setNamedTheme, setUserOverrides, userOverrides } = useEntityTheme()
function onSetTheme(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail || !detail.id) return
  try {
    setNamedTheme(detail.id)
    setMode(detail.mode === 'light' ? 'light' : 'dark')
    setUserOverrides({ ...userOverrides.value, '--accent': detail.accent })
  } catch (err) {
    console.error('[ws-set-theme] 处理失败:', err)
  }
}
const { on: onGlobalEvent } = useGlobalEvents()
onGlobalEvent('ws-set-theme', onSetTheme)

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
  <!-- 跳过导航直达主内容（WCAG 2.4.1 Bypass Blocks）：仅键盘/读屏聚焦时可见 -->
  <a href="#main-content" class="skip-link">跳到主内容</a>
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

/* 跳过导航链接：默认移出屏幕，聚焦时滑入可见（WCAG 2.4.1） */
.skip-link {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 10000;
  padding: 10px 16px;
  background: var(--bg-surface, #fff);
  color: var(--text-primary, #18181b);
  border: 2px solid var(--accent, #4f46e5);
  border-radius: 0 0 var(--radius-sm, 6px) 0;
  font-size: var(--fs-md, 14px);
  text-decoration: none;
  transform: translateY(-200%);
  transition: transform var(--dur-fast, 0.15s) ease;
}
.skip-link:focus,
.skip-link:focus-visible {
  transform: translateY(0);
}
</style>
