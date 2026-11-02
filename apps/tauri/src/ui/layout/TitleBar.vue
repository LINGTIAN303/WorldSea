<template>
  <!-- 自定义标题栏：窗口最顶，替代系统原生标题栏（decorations:false）
       data-tauri-drag-region 提供拖拽移动 + 双击最大化/还原（Tauri 2 内置）
       基础合并（2026-08-08）：MenuBar 左侧功能区（☰ 侧边栏切换 + 项目切换器 + 目录）上移并入窗口栏
      2026-09-30 C 批：旧「space 变体」死代码随 E7 残留清退删除（Agent 面为 dsh 窗口，不吃本组件） -->
  <div class="titlebar" :class="{ 'is-fullscreen': fullscreen }" data-tauri-drag-region>
    <!-- 窗口栏背景层（v2 五目标之一）：绝对定位，不参与拖拽与布局 -->
    <BackgroundLayer target="titlebar" />
    <!-- 左侧：进入 Agent 空间按钮（D1-b 双窗：本页恒为工作台窗，方向固定切到 dsh 窗口；
         胶囊文案=当前空间「工作台」，tooltip=动作「进入 Agent 空间」，与 dsh 侧注入栏对称） -->
    <div class="titlebar-shell-left">
      <button
        class="titlebar-shell-toggle"
        :title="switching ? '正在切换项目' : '进入 Agent 空间'"
        :aria-label="switching ? '正在切换项目' : '进入 Agent 空间'"
        :disabled="switching"
        data-ws-tip-keys="Ctrl+Tab"
        @click="switchShell('space')"
      >
        <WsIcon name="monitor" size="sm" class="shell-toggle-icon" />
        <span class="shell-toggle-label">工作台</span>
      </button>
    </div>
    <div class="titlebar-left" data-tauri-drag-region>
      <ProjectHomeButton />
      <ProjectSwitcher variant="titlebar" :show-brand="false" />
    </div>
    <div class="titlebar-spacer" data-tauri-drag-region></div>
    <div class="titlebar-center" data-tauri-drag-region>
      <span v-if="uiStore.currentView || uiStore.surface === 'home'" class="titlebar-viewname">{{ centerLabel }}</span>
    </div>
    <div class="titlebar-right">
      <div class="titlebar-controls">
      <button class="titlebar-btn" aria-label="更多操作" title="更多操作" @click="openPopupMenu">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>
      </button>
      <button class="titlebar-btn" aria-label="最小化" title="最小化" data-ws-tip-keys="Ctrl+M" @click="minimize">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      <button class="titlebar-btn" :aria-label="maximized ? '还原' : '最大化'" :title="maximized ? '还原' : '最大化/还原'" data-ws-tip-keys="F10" @click="toggleMaximize">
        <!-- 还原图标：两层重叠窗口 -->
        <svg v-if="maximized" width="10" height="10" viewBox="0 0 10 10">
          <rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1"/>
          <path d="M3 3 V1 H9 V7 H7" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
        <!-- 最大化图标：单窗口 -->
        <svg v-else width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      <button class="titlebar-btn titlebar-btn--close" aria-label="关闭" title="关闭（最小化到托盘）" data-ws-tip-keys="Ctrl+W" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { getCurrentWindow, type Window } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@worldsea/entity-core/core'
import { useUIStore } from '@/stores/uiStore'
import { usePluginStore } from '@worldsea/entity-core'
import { WsIcon, BackgroundLayer } from '@worldsea/ui-kit'
import ProjectSwitcher from '@/ui/project/ProjectSwitcher.vue'
import ProjectHomeButton from './ProjectHomeButton.vue'
import { switchShell } from '@/composables/shellSwitch'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'

// 窗口控制仅在 Tauri 环境可用（浏览器预览 5175 时降级为 noop，避免顶层抛错）
let appWindow: Window | null = null
try {
  if (isTauri()) appWindow = getCurrentWindow()
} catch {
  appWindow = null
}
const uiStore = useUIStore()
const pluginStore = usePluginStore()
const { switching } = useProjectSwitcher()

const currentViewLabel = computed(() => {
  const view = pluginStore.views.find((v) => v.id === uiStore.currentView)
  return view?.label ?? ''
})

/* 中心标签：首页态固定「首页」（首页无 currentView），工作台态取当前芽名 */
const centerLabel = computed(() => uiStore.surface === 'home' ? '首页' : currentViewLabel.value)

/* ── 进入 Agent 空间按钮（2026-08-10；D1-b 双窗；2026-09-30 C 批去陈旧壳状态）──
   双窗里本页恒为工作台窗，方向固定「进入 Agent 空间」（与 dsh 侧注入栏的「切换到工作台」对称）；
   入口统一在 `composables/shellSwitch.ts`（壳桥 cmd_shell_space_switch）——与 Ctrl+Tab 共用。 */

function minimize() {
  appWindow?.minimize().catch(e => console.error('[TitleBar] minimize 失败:', e))
}

/* E9 P2：「⋯」→ 壳侧 popup 菜单（cmd_shell_popup_menu 两窗同权；坐标 = 按钮左下角，模态循环 fire-and-forget）。 */
function openPopupMenu(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (!target || !isTauri()) return
  const { left, bottom } = target.getBoundingClientRect()
  invoke('cmd_shell_popup_menu', { x: Math.round(left), y: Math.round(bottom + 2) }).catch(e => console.error('[TitleBar] popup 菜单失败:', e))
}
function toggleMaximize() {
  // 切换后通过 onResized 事件同步 maximized 状态（异步，不在此处假设结果）
  appWindow?.toggleMaximize().catch(e => console.error('[TitleBar] toggleMaximize 失败:', e))
}
async function toggleFullscreen() {
  // 绝对全屏（无边框真全屏，区别于最大化）：F11 浏览器惯例
  if (!appWindow) return
  try {
    const entering = !(await appWindow.isFullscreen())
    // G1 收尾批修：进全屏前先脱最大化（tao 直在最大化窗上全屏 → 任务栏条 + max+fs 坏组合）
    if (entering && await appWindow.isMaximized()) await appWindow.unmaximize()
    await appWindow.setFullscreen(entering)
    await syncFullscreen()
  } catch (e) {
    console.error('[TitleBar] toggleFullscreen 失败:', e)
  }
}

/* ── 窗口控制快捷键（2026-09-06 系统级，固定键位不可配置）──
   刻意不进 useShortcuts 注册表：窗口管理独立于应用内容，与 OS 的 Alt+F4 同语义，
   弹窗打开/输入框聚焦期间照常可用（注册表的 isInput 跳过与弹窗深度屏蔽均不适用）。
   仅桌面壳有实际效果（浏览器预览 appWindow 为 null 自然空转）；
   展示于帮助弹窗「系统级」分组（仅 Tauri 壳显示），登记于快捷键系统.md §3。 */
function onWindowKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  const mod = e.ctrlKey || e.metaKey
  const anyMod = mod || e.altKey || e.shiftKey
  switch (e.key.toLowerCase()) {
    case 'm': if (mod && !e.altKey && !e.shiftKey) { e.preventDefault(); minimize() } break
    case 'f10': if (!anyMod) { e.preventDefault(); toggleMaximize() } break
    case 'f11': if (!anyMod) { e.preventDefault(); toggleFullscreen() } break
    case 'w': if (mod && !e.altKey && !e.shiftKey) { e.preventDefault(); close() } break
  }
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

/* ── 最大化状态跟踪：最大化时图标切换为还原 ── */
const maximized = ref(false)
let unlistenResized: (() => void) | null = null

async function syncMaximized() {
  if (!appWindow) return
  try {
    maximized.value = await appWindow.isMaximized()
  } catch {
    maximized.value = false
  }
}

const fullscreen = ref(false) // G1 收尾：全屏态驱动隐栏（与 Agent 侧同观感）；全屏中控件不可达属选定口径，F11 退出即恢复
async function syncFullscreen() {
  if (!appWindow) return
  try { fullscreen.value = await appWindow.isFullscreen() } catch { fullscreen.value = false }
  // 全屏态广播到根节点：全屏隐栏后，模态遮罩（如 .set-overlay）据此把让位偏移归零
  document.documentElement.dataset.fullscreen = fullscreen.value ? 'true' : 'false'
}

onMounted(async () => {
  if (!appWindow) return
  await syncMaximized()
  await syncFullscreen()
  try {
    unlistenResized = await appWindow.onResized(() => { void syncMaximized(); void syncFullscreen() })
  } catch {
    // 浏览器预览等非 Tauri 环境无窗口事件，忽略
  }
})

onBeforeUnmount(() => {
  unlistenResized?.()
})
function close() {
  // 触发 CloseRequested → Rust 侧托盘激活时拦截为最小化到托盘
  appWindow?.close().catch(e => console.error('[TitleBar] close 失败:', e))
}
</script>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  /* 高度单一真源在 theme.css --titlebar-height（模态遮罩让位窗口栏也读它） */
  height: var(--titlebar-height, 32px);
  flex-shrink: 0;
  /* 顶栏取中性灰（三级中性灰分区之一，2026-08-12）：胶囊填充 = 面板色（--switch-bg: var(--bg-surface)），
     两色一致时胶囊会「看不见」（只剩文字与图标）——故底色统一落到 --bg-muted */
  --titlebar-bg: var(--sf-chrome-bg);
  background: var(--titlebar-bg, var(--color-bg-surface));
  -webkit-backdrop-filter: var(--sf-chrome-filter, none);
  backdrop-filter: var(--sf-chrome-filter, none);
  border-bottom: 1px solid var(--border, var(--color-border));
  user-select: none;
  -webkit-user-select: none;
  position: relative;
  /* 高于内容区，保证 ⋯ 下拉菜单浮层可见 */
  z-index: 100;
}
/* G1 收尾：全屏＝沉浸——隐栏（.shell 为 flex 纵向、shell-body flex:1，隐后内容区自然接管全高） */
.titlebar.is-fullscreen {
  display: none;
}
.titlebar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 6px;
  /* 不裁切：AppMenu 下拉需要溢出可见（各子元素自带 max-width + overflow 截断） */
  white-space: nowrap;
}
/* 窗口栏左侧：进入 Agent 空间按钮 */
.titlebar-shell-left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.titlebar-shell-left .titlebar-shell-toggle {
  margin-left: 2px;
}
/* Agent 空间 / 工作台 切换按钮（2026-08-12）：默认填充激活，悬停时填充向外扩散到空心 */
.titlebar-shell-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  margin-left: 6px;
  padding: 0 12px;
  background: transparent;
  color: var(--switch-bg);
  cursor: pointer;
  border-radius: 999px;
  font-size: var(--font-size-sm, 12px);
  font-weight: 600;
  white-space: nowrap;
  border: none;
  flex-shrink: 0;
  overflow: hidden;
  transition: color 0.5s ease;
}
/* 填充层：默认覆盖整个胶囊（激活填充），悬停时向外扩散并淡出，露出空心。
   border-radius: inherit 让填充匹配胶囊形状，避免水平椭圆 */
.titlebar-shell-toggle::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 118%;
  height: 118%;
  border-radius: inherit;
  background: var(--switch-bg);
  transform: translate(-50%, -50%) scale(1);
  z-index: 1;
  transition: transform 0.5s ease, opacity 0.5s ease;
}
.titlebar-shell-toggle:hover::after {
  transform: translate(-50%, -50%) scale(1.7);
  opacity: 0;
}
.titlebar-shell-toggle:hover {
  color: var(--switch-bg);
}
.titlebar-shell-toggle:disabled {
  opacity: var(--disabled-opacity, 0.5);
  cursor: not-allowed;
}
.titlebar-shell-toggle:disabled:hover::after {
  transform: translate(-50%, -50%) scale(1);
  opacity: 1;
}
.shell-toggle-label,
.titlebar-shell-toggle :deep(.shell-toggle-icon) {
  position: relative;
  z-index: 2;
  transition: color 0.5s ease;
  color: var(--switch-fg);
}
/* 填充散开变空心后，文字/图标随之切换为主文字色，保证在各主题下对比度 */
.titlebar-shell-toggle:hover .shell-toggle-label,
.titlebar-shell-toggle:hover :deep(.shell-toggle-icon) {
  color: var(--text-primary);
}
/* 项目切换器：紫点 + WorldSea + 项目名 + ▾，点击打开项目管理 */
.titlebar-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm, 6px);
  transition: background 0.12s;
  max-width: 340px;
  overflow: hidden;
}
.titlebar-switcher:hover {
  background: var(--bg-hover, var(--color-bg-hover));
}
.titlebar-logo {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.titlebar-title {
  font-size: var(--font-size-sm, 12px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--text-color, var(--color-text-primary));
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.titlebar-project {
  font-size: var(--font-size-sm, 12px);
  color: var(--text-secondary, var(--color-text-secondary));
  overflow: hidden;
  text-overflow: ellipsis;
}
.titlebar-project::before {
  content: '·';
  margin-right: 6px;
  color: var(--text-tertiary, var(--color-text-tertiary));
}
.titlebar-chevron {
  font-size: var(--fs-2xs);
  color: var(--text-tertiary, var(--color-text-tertiary));
  margin-top: 1px;
  flex-shrink: 0;
}
.titlebar-spacer {
  flex: 1;
  height: 100%;
}
/* 视图名：窗口栏正中（绝对定位精确居中，不受左右宽度差影响） */
.titlebar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  max-width: 40%;
  overflow: hidden;
}
.titlebar-viewname {
  font-size: var(--font-size-sm, 12px);
  color: var(--text-secondary, var(--color-text-secondary));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.titlebar-right {
  display: flex;
  align-items: center;
  height: 100%;
  flex-shrink: 0;
}
.titlebar-controls {
  display: flex;
  height: 100%;
}
.titlebar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text-secondary, var(--color-text-secondary));
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.titlebar-btn:hover {
  background: var(--bg-hover, var(--color-bg-hover));
  color: var(--text-color, var(--color-text-primary));
}
.titlebar-btn--close:hover {
  background: var(--danger);
  color: var(--on-accent);
}
</style>
