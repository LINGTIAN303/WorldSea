<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import Shell from './ui/layout/Shell.vue'
import { useUIStore } from './stores/uiStore'
import { useTheme } from './components/ui/useTheme'
import { useTheme as useEntityTheme, useSettingsStore, useIconAssetStore } from '@worldsea/entity-core'
import { useGlobalEvents, setActiveViewId, enableGlobalTooltips, registerCustomIconResolver } from '@worldsea/ui-kit'
import { useFontBootstrap } from '@worldsea/font-kit'
import { bootstrapShell } from './plugins/boot'
import { startBackendBoot } from './boot/backendBoot'
import { useProjectSwitcher } from './composables/useProjectSwitcher'
import { loadProjectBackgroundForCurrentProject } from './composables/useBackgroundBootstrap'
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
// 自定义图标：store 负责项目/全局登记，WsIcon 只认这个运行时 URL 解析位
const iconAssets = useIconAssetStore()
registerCustomIconResolver(id => {
  const src = iconAssets.resolveRuntimeUrl(id)
  return src ? { src } : null
})
/** Splash 显式离场窗口：ready 后保留 750ms 让 600ms 淡出真正播放 */
const splashVisible = ref(true)
let splashHideTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => uiStore.bootState,
  (state) => {
    if (state === 'ready' && splashVisible.value) {
      splashHideTimer = setTimeout(() => { splashVisible.value = false }, 750)
    } else if (state === 'error') {
      if (splashHideTimer) {
        clearTimeout(splashHideTimer)
        splashHideTimer = null
      }
      splashVisible.value = false
    }
  },
)

onUnmounted(() => {
  if (splashHideTimer) clearTimeout(splashHideTimer)
})
// entity-core 主题引擎（强调色轴）：模块加载时已完成旧主题 id → accent id 迁移
const { setAccent, setCustomAccent, restorePersistedTheme } = useEntityTheme()

/**
 * 主题两轴统一落地（2026-09-13 收束：主题 = 底色 × 强调色；AppearancePanel 派发 ws-set-theme）。
 * App.vue 恒挂载（AgentSpace / Shell 平级切换），在此注册保证两种壳都生效。
 * - detail.mode（'light'|'dark'|'system'）→ App 壳三态（data-theme 唯一控制源；system 恢复跟随）
 * - detail.accentHex（取色器任意色）→ entity-core setCustomAccent（锚点合规化 + OKLCH 派生）
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
    if (typeof detail.accentHex === 'string' && detail.accentHex) {
      setCustomAccent(detail.accentHex)
    } else if (typeof detail.accent === 'string' && detail.accent) {
      setAccent(detail.accent)
    }
  } catch (err) {
    console.error('[ws-set-theme] 处理失败:', err)
  }
}
const { on: onGlobalEvent } = useGlobalEvents()
onGlobalEvent('ws-set-theme', onSetTheme)

/**
 * 眼睛虹膜色（世界之眼品牌件独立配色，2026-10-26 走查反馈）：
 * 根变量 --ws-eye-iris 供 WorldEye 消费；color=null = 回落强调色轴。
 * 键 worldsea-eye-iris 与 splash 独立入口 / dsh_space_veil.js 同源（启动页与切换遮罩同步生效）。
 */
function onSetEyeIris(e: Event) {
  const color = (e as CustomEvent).detail?.color
  try {
    if (typeof color === 'string' && color) {
      localStorage.setItem('worldsea-eye-iris', color)
      document.documentElement.style.setProperty('--ws-eye-iris', color)
    } else {
      localStorage.removeItem('worldsea-eye-iris')
      document.documentElement.style.removeProperty('--ws-eye-iris')
    }
  } catch (err) {
    console.error('[ws-set-eye-iris] 处理失败:', err)
  }
}
onGlobalEvent('ws-set-eye-iris', onSetEyeIris)

// 视图上下文注入：view 快捷键跟随当前视图（未装载视图=null 时 view 层失效；
// 旧 Agent 空间壳已随本体删除，2026-09-27 E7）
watch(
  () => uiStore.currentView,
  (view) => {
    setActiveViewId(view)
  },
  { immediate: true },
)

/** 启动步骤超时：避免 Splash 因底层 Promise 悬挂而永久停留 */
async function withBootTimeout<T>(task: Promise<T>, label: string, ms = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)}s）`)), ms)
  })
  try {
    return await Promise.race([task, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 启动链（真实阶段）：
 * backend → project → shell → bridge → ready；任何关键步骤失败进入 BootErrorScreen。
 * 系统桥是非关键步骤，失败只记录，不阻塞进入工作台。
 */
async function runBoot(): Promise<void> {
  try {
    uiStore.setBootStage('backend')
    await withBootTimeout(startBackendBoot(), '初始化核心')

    uiStore.setBootStage('project')
    await withBootTimeout(projectSwitcher.initialize(), '恢复项目')
    // 项目背景覆盖异步加载：不阻塞启动；失败只告警，界面回落全局背景
    void loadProjectBackgroundForCurrentProject().catch(err => {
      console.warn('[Background] 项目背景加载失败:', err)
    })

    uiStore.setBootStage('shell')
    await withBootTimeout(bootstrapShell(), '装配界面')

    uiStore.setBootStage('bridge')
    try {
      await withBootTimeout(setupSystemBridge(), '系统桥接', 10_000)
    } catch (err) {
      console.warn('[App] 系统桥初始化失败（不阻塞启动）:', err)
    }

    uiStore.markReady()
  } catch (err) {
    console.error('[App] 启动失败:', err)
    uiStore.markBootError([{
      id: 'boot',
      name: '启动',
      error: err instanceof Error ? err.message : String(err),
    }])
  }
}

onMounted(() => {
  // 启动首绘门回报（workspace_window.rs）：启动预建的工作台窗由此显示——窗口出现即已是启动页，
  // 全程无空白帧。仅预建路径持门；主窗/浏览器预览等无门场景为 no-op，命令缺失（旧壳）静默。
  invoke('cmd_workspace_first_paint').catch(() => {})
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
  // 眼睛虹膜色恢复（根变量直设；缺省无键 = 回落强调色轴，不动）
  try {
    const eyeIris = localStorage.getItem('worldsea-eye-iris')
    if (eyeIris) document.documentElement.style.setProperty('--ws-eye-iris', eyeIris)
  } catch { /* localStorage 不可用忽略 */ }
  // 字体系统启动恢复（字体系统 v2 批 1）：恢复已装字体 FontFace（IndexedDB）+ 重放分层变量与字号档位。
  // 异步不阻塞启动；失败仅告警——恢复前 CSS 变量指向悬空 family 时回退 --font-sans，恢复完成即生效。
  useFontBootstrap().bootstrap().catch((err) => {
    console.warn('[App] 字体库恢复失败（不影响启动）:', err)
  })
  void runBoot()
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

  <!-- 启动流程：Splash 保留到淡出结束；错误态立即让位给 BootErrorScreen。 -->
  <SplashScreen v-if="splashVisible" />
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
