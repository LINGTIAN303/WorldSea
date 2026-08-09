<template>
  <!-- 自定义标题栏：窗口最顶，替代系统原生标题栏（decorations:false）
       data-tauri-drag-region 提供拖拽移动 + 双击最大化/还原（Tauri 2 内置）
       基础合并（2026-08-08）：MenuBar 左侧功能区（☰ 侧边栏切换 + 项目切换器 + 目录）上移并入窗口栏
       variant="space"（2026-08-09）：Agent 空间精简窗口栏——仅拖拽区 + 居中标题 + 窗口控制，
       隐藏工作台专属区（☰ 侧边栏 / 项目切换器 / 目录 / AppMenu / 视图名） -->
  <div class="titlebar" data-tauri-drag-region>
    <template v-if="variant === 'workbench'">
      <div class="titlebar-left" data-tauri-drag-region>
        <button class="titlebar-toggle" aria-label="切换侧边栏" title="切换侧边栏 (Ctrl+B)" @click="toggleSidebar">☰</button>
        <button class="titlebar-switcher" title="切换项目" @click="openProjectManager">
          <span class="titlebar-dot"></span>
          <span class="titlebar-title">WorldSmith</span>
          <span v-if="projectName" class="titlebar-project">{{ projectName }}</span>
          <span class="titlebar-chevron">▾</span>
        </button>
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
      <AppMenu v-if="variant === 'workbench'" />
      <div class="titlebar-controls">
      <button class="titlebar-btn" aria-label="最小化" title="最小化" @click="minimize">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      <button class="titlebar-btn" aria-label="最大化/还原" title="最大化/还原" @click="toggleMaximize">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      <button class="titlebar-btn titlebar-btn--close" aria-label="关闭" title="关闭（最小化到托盘）" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>
      </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getCurrentWindow, type Window } from '@tauri-apps/api/window'
import { isTauri } from '@worldsmith/entity-core/core'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import { useFileSystemProject } from '@/composables/useFileSystemProject'
import { useUIStore } from '@/stores/uiStore'
import { usePluginStore } from '@worldsmith/entity-core'
import AppMenu from './AppMenu.vue'

// 变体：workbench=工作台完整窗口栏 / space=Agent 空间精简窗口栏（2026-08-09）
const props = withDefaults(defineProps<{
  variant?: 'workbench' | 'space'
  /** space 变体居中标题（缺省 "WorldSmith — Agent 空间"） */
  title?: string
}>(), {
  variant: 'workbench',
  title: 'WorldSmith — Agent 空间',
})

// 窗口控制仅在 Tauri 环境可用（浏览器预览 5175 时降级为 noop，避免顶层抛错）
let appWindow: Window | null = null
try {
  if (isTauri()) appWindow = getCurrentWindow()
} catch {
  appWindow = null
}
const { currentProject } = useProjectSwitcher()
const { dirName } = useFileSystemProject()
const uiStore = useUIStore()
const pluginStore = usePluginStore()

const projectName = computed(() => currentProject.value?.name ?? '')
const currentViewLabel = computed(() => {
  const view = pluginStore.views.find((v) => v.id === uiStore.currentView)
  return view?.label ?? ''
})

function toggleSidebar() {
  uiStore.toggleSidebar()
}
function openProjectManager() {
  // 与 MenuBar 项目切换器一致：通过全局事件打开项目管理弹窗
  window.dispatchEvent(new CustomEvent('ws-open-project-manager'))
}

function minimize() {
  appWindow?.minimize().catch(e => console.error('[TitleBar] minimize 失败:', e))
}
function toggleMaximize() {
  appWindow?.toggleMaximize().catch(e => console.error('[TitleBar] toggleMaximize 失败:', e))
}
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
  background: var(--titlebar-bg, var(--color-bg-surface));
  border-bottom: 1px solid var(--border, var(--color-border));
  user-select: none;
  -webkit-user-select: none;
  position: relative;
  /* 高于内容区，保证 ⋯ 下拉菜单浮层可见 */
  z-index: 100;
}
.titlebar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 6px;
  overflow: hidden;
  white-space: nowrap;
}
/* ☰ 侧边栏切换：小方按钮，悬停反馈 */
.titlebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-md, 14px);
  border-radius: var(--radius-sm, 6px);
  color: var(--text-secondary, var(--color-text-secondary));
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}
.titlebar-toggle:hover {
  background: var(--bg-hover, var(--color-bg-hover));
  color: var(--text-color, var(--color-text-primary));
}
/* 项目切换器：紫点 + WorldSmith + 项目名 + ▾，点击打开项目管理 */
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
.titlebar-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary);
  opacity: 0.85;
  flex-shrink: 0;
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
.titlebar-btn--close:hover {
  background: var(--danger);
  color: var(--on-accent);
}
</style>
