<script setup lang="ts">
import { onMounted, watch } from 'vue'
import Shell from './ui/layout/Shell.vue'
import { useUIStore } from './stores/uiStore'
import { useTheme } from './components/ui/useTheme'
import { useTheme as useEntityTheme, useSettingsStore } from '@worldsea/entity-core'
import { useGlobalEvents, setActiveViewId, setAgentSpaceActive, enableGlobalTooltips } from '@worldsea/ui-kit'
import { bootstrapShell } from './plugins/boot'
import { useProjectSwitcher } from './composables/useProjectSwitcher'
import { useSystemBridge } from './composables/useSystemBridge'
import SplashScreen from './ui/boot/SplashScreen.vue'
import GlobalEditMenu from './ui/GlobalEditMenu.vue'
import BootErrorScreen from './ui/boot/BootErrorScreen.vue'

// ── 无障碍：减弱动态效果（应用级配置） ──
// 写入根元素 data-reduce-motion，CSS 据此关闭界面动效（Agent 设置翻卡等）；
// 默认不减弱（保留动画），由「设置 → 动画效果」开关控制
const settingsStore = useSettingsStore()
watch(() => settingsStore.reduceMotion, (v) => {
  document.documentElement.dataset.reduceMotion = v ? 'on' : 'off'
}, { immediate: true })

// ── 动画效果分组开关（应用级配置） ──
// 每组合开关写入根元素 data-anim-<组>（如 data-anim-messages），CSS 据此关闭对应组件动画；
// 默认全部开启，由「设置 → 动画效果」面板逐项控制
watch(() => settingsStore.animations, (a) => {
  for (const [k, v] of Object.entries(a ?? {})) {
    document.documentElement.dataset[`anim${k[0].toUpperCase()}${k.slice(1)}`] = v ? 'on' : 'off'
  }
}, { immediate: true, deep: true })

// 主题初始化：Shell 与 AgentSpace 共用（三态；components/ui/useTheme 已内置
// 跟随系统——preference 'system' 默认态 + matchMedia 实时监听，无需额外实现）
const { theme: themeMode, apply: applyTheme, setMode, followSystem } = useTheme()
// 系统层桥：托盘事件监听 + 状态同步（App 启动时 setup，幂等）
const { setup: setupSystemBridge } = useSystemBridge()

const uiStore = useUIStore()
const projectSwitcher = useProjectSwitcher()
// entity-core 主题引擎（强调色轴）：模块加载时已完成旧主题 id → accent id 迁移
const { setAccent, restorePersistedTheme } = useEntityTheme()

/**
 * 主题两轴统一落地（2026-09-13 收束：主题 = 底色 × 强调色；AppearancePanel 派发 ws-set-theme）。
 * App.vue 恒挂载（AgentSpace / Shell 平级切换），在此注册保证两种壳都生效。
 * - detail.mode（'light'|'dark'|'system'）→ App 壳三态（data-theme 唯一控制源；system 恢复跟随）
 * - detail.accent（强调色 id）→ entity-core setAccent（深浅双段规则注入 + 用户令牌重放）
 */
function onSetTheme(e: Event) {
  const detail = (e as CustomEvent).detail ?? {}
  try {
    if (detail.mode === 'system') {
      followSystem()
    } else if (detail.mode === 'light' || detail.mode === 'dark') {
      setMode(detail.mode)
    }
    if (typeof detail.accent === 'string' && detail.accent) {
      setAccent(detail.accent)
    }
  } catch (err) {
    console.error('[ws-set-theme] 处理失败:', err)
  }
}
const { on: onGlobalEvent } = useGlobalEvents()
onGlobalEvent('ws-set-theme', onSetTheme)

// 视图上下文注入：view 快捷键跟随当前视图（旧 Agent 空间壳已随本体删除，2026-09-27 E7；
// space scope 由此恒为未激活）
watch(
  () => [uiStore.currentShell, uiStore.currentView] as const,
  ([shell, view]) => {
    setAgentSpaceActive(shell === 'space')
    setActiveViewId(view)
  },
  { immediate: true },
)

onMounted(async () => {
  // 全局 Tooltip 接管：摘除全站原生 title，统一为自定义浮层（2026-09-06 方案A）
  enableGlobalTooltips()
  // 全局拦截浏览器原生右键菜单（2026-09-06 桌面应用惯例）：事件仍正常传播，
  // 各组件自定义右键菜单不受影响；输入元素的编辑菜单由 GlobalEditMenu 组件接管
  document.addEventListener('contextmenu', e => e.preventDefault())
  // 应用初始主题（html data-theme 由此建立；apply 为同步函数，需传入当前主题模式）
  applyTheme(themeMode.value)
  // 主题恢复第二轴：强调色规则注入 + 用户令牌覆盖重放（圆角/密度等）。
  // 收束前缺失此步——重启后 --accent 与覆盖令牌不恢复，观感回退裸基准。
  try {
    restorePersistedTheme()
  } catch (err) {
    console.error('[App] 主题恢复失败:', err)
  }
  // 项目系统初始化 + projectDir 绑定（必须在 bootstrapShell 之前：
  // 芽初始化 / Store loadAll 依赖 FileStorageBackend 已就绪，否则 isReady=false
  // 会降级到不可用的 TauriStorageBackend，导致 cmd_get_all_entities 等 IPC 失败）
  try {
    await projectSwitcher.initialize()
  } catch (err) {
    console.error('[App] 项目系统初始化失败:', err)
  }
  // 产品壳装配：视图同步单点 + 首屏默认视图（芽视图由第二棵树注册，见 src/world/）
  await bootstrapShell()
  // 系统层桥初始化：托盘事件监听 + 最近项目同步（异步，不阻塞启动）
  void setupSystemBridge()
  // 核心启动完成 → 通知 SplashScreen 淡出（bootState: 'booting' → 'ready'）
  uiStore.markReady()
})
</script>

<template>
  <!-- 跳过导航直达主内容（WCAG 2.4.1 Bypass Blocks）：仅键盘/读屏聚焦时可见。
       本页即工作台（Agent 面为 dsh 独立窗口，旧 Agent 空间壳已随本体删除 2026-09-27 E7） -->
  <a href="#main-content" class="skip-link">跳到主内容</a>
  <Shell />

  <!-- 统一输入框右键菜单（撤销/重做/剪切/复制/粘贴/删除/全选）；
       非输入元素的右键由 onMounted 的全局 contextmenu 拦截 -->
  <GlobalEditMenu />

  <!-- 启动流程：bootState 驱动 Splash（booting）/ 错误页（error）。ready 后均卸载。 -->
  <SplashScreen v-if="uiStore.bootState === 'booting'" />
  <BootErrorScreen v-if="uiStore.bootState === 'error'" />
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
