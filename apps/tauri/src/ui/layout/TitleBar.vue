<template>
  <!-- 自定义标题栏：窗口最顶，替代系统原生标题栏（decorations:false）
       data-tauri-drag-region 提供拖拽移动 + 双击最大化/还原（Tauri 2 内置）
       基础合并（2026-08-08）：MenuBar 左侧功能区（☰ 侧边栏切换 + 项目切换器 + 目录）上移并入窗口栏
       variant="space"（2026-08-09）：Agent 空间精简窗口栏——仅拖拽区 + 居中标题 + 窗口控制，
       隐藏工作台专属区（☰ 侧边栏 / 项目切换器 / 目录 / AppMenu / 视图名） -->
  <div class="titlebar" :class="{ 'is-space': variant === 'space' }" data-tauri-drag-region>
    <!-- 左侧：Agent 空间/工作台 切换按钮（两种壳共用；取代原 ⋯ 更多操作菜单位） + space 变体注入面板控件
         2026-09-06：space 变体下 左栏开关移到最左，壳切换（Agent 空间）随其后 -->
    <div class="titlebar-shell-left">
      <!-- [A1] space 变体：AgentSpace 注入左侧栏开关（PanelToggle）等 -->
      <slot v-if="variant === 'space'" name="space-left" />
      <button
        class="titlebar-shell-toggle"
        :title="shellToggleTitle"
        :aria-label="shellToggleTitle"
        data-ws-tip-keys="Ctrl+Tab"
        @click="toggleShell"
      >
        <WsIcon :name="shellToggleIcon" size="sm" class="shell-toggle-icon" />
        <span class="shell-toggle-label">{{ shellToggleLabel }}</span>
      </button>
    </div>
    <template v-if="variant === 'workbench'">
      <div class="titlebar-left" data-tauri-drag-region>
        <ProjectSwitcher variant="titlebar" />
        <span v-if="dirName" class="titlebar-dir" :title="dirName">{{ dirName }}</span>
      </div>
      <div class="titlebar-spacer" data-tauri-drag-region></div>
      <div class="titlebar-center" data-tauri-drag-region>
        <span v-if="uiStore.currentView" class="titlebar-viewname">{{ currentViewLabel }}</span>
      </div>
    </template>
    <template v-else>
      <!-- space 变体：拖拽区 + 居中标题（AgentSpace 顶部挂载） -->
      <div class="titlebar-spacer" data-tauri-drag-region></div>
      <div class="titlebar-center" data-tauri-drag-region>
        <span class="titlebar-viewname">{{ title }}</span>
      </div>
      <div class="titlebar-spacer" data-tauri-drag-region></div>
    </template>
    <div class="titlebar-right">
      <div class="titlebar-controls">
      <!-- E9 P2（2026-09-27 拍板）：产品窗补「⋯」popup 菜单——文件/编辑/视图/设置，与 dsh 窗注入窗口栏同源（壳侧同一份菜单资源） -->
      <button class="titlebar-btn titlebar-btn--more" aria-label="更多操作" title="更多操作" @click="openPopupMenu">
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
import { useFileSystemProject } from '@/composables/useFileSystemProject'
import { useUIStore } from '@/stores/uiStore'
import { usePluginStore } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'
import ProjectSwitcher from '@/ui/project/ProjectSwitcher.vue'
import { toggleShell } from '@/composables/shellSwitch'

// 变体：workbench=工作台完整窗口栏 / space=Agent 空间精简窗口栏（2026-08-09）
const props = withDefaults(defineProps<{
  variant?: 'workbench' | 'space'
  /** space 变体居中标题（缺省 "WorldSea — Agent 空间"） */
  title?: string
}>(), {
  variant: 'workbench',
  title: 'WorldSea — Agent 空间',
})

// 窗口控制仅在 Tauri 环境可用（浏览器预览 5175 时降级为 noop，避免顶层抛错）
let appWindow: Window | null = null
try {
  if (isTauri()) appWindow = getCurrentWindow()
} catch {
  appWindow = null
}
const { dirName } = useFileSystemProject()
const uiStore = useUIStore()
const pluginStore = usePluginStore()

const currentViewLabel = computed(() => {
  const view = pluginStore.views.find((v) => v.id === uiStore.currentView)
  return view?.label ?? ''
})

/* ── Agent 空间 / 工作台 切换按钮（2026-08-10；D1-b 2026-09-24 起双窗）──
   新壳里两个空间是**独立窗口**（dsh 页 / 工作台页各一窗），切换交壳做互斥显隐；
   入口统一在 `composables/shellSwitch.ts`（桥优先，无桥回退页内壳切换）——与 Ctrl+Tab、托盘共用。 */
const shellToggleLabel = computed(() => uiStore.currentShell === 'space' ? 'Agent 空间' : '工作台')
const shellToggleIcon = computed(() => uiStore.currentShell === 'space' ? 'chat' : 'monitor')
const shellToggleTitle = computed(() => uiStore.currentShell === 'space' ? '切换到工作台' : '进入 Agent 空间')

function minimize() {
  appWindow?.minimize().catch(e => console.error('[TitleBar] minimize 失败:', e))
}

/* E9 P2：「⋯」→ 壳侧 popup 菜单（cmd_shell_popup_menu 在 allow-shell-bridge 组，两窗同权）；
   坐标 = 按钮左下角页面 CSS 像素（壳经 LogicalPosition 换算弹出；弹出是模态循环，fire-and-forget）。 */
function openPopupMenu(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (!target || !isTauri()) return
  const rect = target.getBoundingClientRect()
  invoke('cmd_shell_popup_menu', { x: Math.round(rect.left), y: Math.round(rect.bottom + 2) })
    .catch(e => console.error('[TitleBar] popup 菜单失败:', e))
}
function toggleMaximize() {
  // 切换后通过 onResized 事件同步 maximized 状态（异步，不在此处假设结果）
  appWindow?.toggleMaximize().catch(e => console.error('[TitleBar] toggleMaximize 失败:', e))
}
async function toggleFullscreen() {
  // 绝对全屏（无边框真全屏，区别于最大化）：F11 浏览器惯例
  if (!appWindow) return
  try {
    await appWindow.setFullscreen(!(await appWindow.isFullscreen()))
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

onMounted(async () => {
  if (!appWindow) return
  await syncMaximized()
  try {
    unlistenResized = await appWindow.onResized(() => { void syncMaximized() })
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
  height: 32px;
  flex-shrink: 0;
  /* 顶栏取中性灰（三级中性灰分区之一，2026-08-12）：胶囊填充 = 面板色（--switch-bg: var(--bg-surface)），
     两色一致时胶囊会「看不见」（只剩文字与图标）——故两变体统一把底色落到 --bg-muted */
  --titlebar-bg: var(--bg-muted);
  background: var(--titlebar-bg, var(--color-bg-surface));
  border-bottom: 1px solid var(--border, var(--color-border));
  user-select: none;
  -webkit-user-select: none;
  position: relative;
  /* 高于内容区，保证 ⋯ 下拉菜单浮层可见 */
  z-index: 100;
}
/* space 变体：顶栏并入深色带（2026-08-12，与 SpaceNavbar 同 bg-muted 连成连续深色带）
   去掉下沿分割线，与缝隙同色融为一体 */
.titlebar.is-space {
  border-bottom: none;
}
.titlebar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 6px;
  /* 不裁切：AppMenu 下拉需要溢出可见（各子元素自带 max-width + overflow 截断） */
  white-space: nowrap;
}
/* [A1] 窗口栏左侧：Agent空间/工作台切换 + space 变体注入的面板控件（PanelToggle） */
.titlebar-shell-left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.titlebar-shell-left :deep(.panel-toggle) {
  height: 32px;
}
/* 2026-09-06 换位后：左栏开关贴左缘，2px 间距移到壳切换钮上 */
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
/* 已绑定目录路径标签 */
.titlebar-dir {
  font-size: var(--font-size-sm, 12px);
  color: var(--text-secondary, var(--color-text-secondary));
  background: var(--bg-hover, var(--color-bg-hover));
  padding: 1px 8px;
  border-radius: var(--radius-sm, 6px);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: 2px;
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
/* E9 P2：「⋯」更多操作（壳栏 wstb-more 同款宽度 36px；控制键 44px） */
.titlebar-btn--more {
  width: 36px;
}
.titlebar-btn--close:hover {
  background: var(--danger);
  color: var(--on-accent);
}
</style>
