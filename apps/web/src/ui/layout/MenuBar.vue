<template>
  <div class="menubar">
    <div class="menubar-left">
      <button class="menubar-toggle" aria-label="切换侧边栏" @click="uiStore.toggleSidebar" :title="uiStore.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'">☰</button>
      <button class="menubar-project-switcher" @click="openProjectManager" title="切换项目">
        <span class="menubar-title">WorldSmith</span>
        <span v-if="currentProjectName" class="menubar-project-name">{{ currentProjectName }}</span>
        <span class="menubar-project-chevron">▾</span>
      </button>
      <span v-if="isProjectOpen" class="menubar-project" :title="dirName">{{ dirName }}</span>
    </div>
    <div class="menubar-center">
      <span v-if="uiStore.currentView" class="menubar-viewname">{{ currentViewLabel }}</span>
    </div>
    <div class="menubar-right">
      <div
        class="menu-dropdown-wrapper"
        @mouseenter="onWrapperEnter"
        @mouseleave="onWrapperLeave"
      >
        <button
          class="menubar-btn"
          :class="{ 'menubar-btn--pinned': pinned }"
          aria-label="更多操作"
          @click="togglePin"
        >⋯</button>
        <Transition name="ws-menu">
          <div
            v-if="menuVisible"
            class="menu-dropdown"
            role="menu"
          >
            <div class="menu-dropdown-arrow"></div>
            <div class="menu-dropdown-list">
              <button class="menu-item" role="menuitem" @click="openSearch">
                <WsIcon name="search" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">搜索</span>
                <span class="menu-item-shortcut">{{ formatKeysForDisplay(['ctrl', 'k']) }}</span>
              </button>
              <button class="menu-item" role="menuitem" @click="openFolder">
                <WsIcon name="folder-open" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">{{ isProjectOpen ? '切换项目目录' : '绑定项目目录' }}</span>
                <span class="menu-item-shortcut"></span>
              </button>
              <button class="menu-item" role="menuitem" @click="saveFolder" :disabled="saving">
                <WsIcon name="save" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">{{ saving ? '导出中...' : '导出到文件夹' }}</span>
                <span class="menu-item-shortcut">{{ formatKeysForDisplay(['ctrl', 's']) }}</span>
              </button>
              <button class="menu-item" role="menuitem" @click="openImportExport">
                <WsIcon name="trade" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">导入/导出</span>
                <span class="menu-item-shortcut">{{ formatKeysForDisplay(['ctrl', 'shift', 's']) }}</span>
              </button>
              <button class="menu-item" role="menuitem" @click="openBatchEdit">
                <WsIcon name="edit" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">批量编辑</span>
                <span class="menu-item-shortcut"></span>
              </button>
              <button class="menu-item" role="menuitem" @click="openTemplate">
                <WsIcon name="list" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">模板管理</span>
                <span class="menu-item-shortcut"></span>
              </button>
              <button class="menu-item" role="menuitem" @click="openVersion">
                <WsIcon name="timeline" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">最近修改</span>
                <span class="menu-item-shortcut"></span>
              </button>
              <button class="menu-item" role="menuitem" @click="openDocExport">
                <WsIcon name="print" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">导出文档</span>
                <span class="menu-item-shortcut"></span>
              </button>
              <button class="menu-item" role="menuitem" @click="openLayoutMgr">
                <WsIcon name="module-builder" size="sm" class="menu-item-icon" />
                <span class="menu-item-label">布局管理</span>
                <span class="menu-item-shortcut"></span>
              </button>
            </div>
            <div class="menu-divider"></div>
            <button class="menu-item" role="menuitem" @click="openAgentSpace">
              <span class="menu-item-icon"><WsIcon name="chat" size="sm" /></span>
              <span class="menu-item-label">Agent 空间</span>
              <span class="menu-item-shortcut"></span>
            </button>
            <button class="menu-item" role="menuitem" @click="openSettings">
              <span class="menu-item-icon"><WsIcon name="settings" size="sm" /></span>
              <span class="menu-item-label">设置</span>
              <span class="menu-item-shortcut">{{ formatKeysForDisplay(['ctrl', ',']) }}</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>
    <div
      v-if="pinned"
      class="menu-overlay"
      @click="unpin"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '@/stores/uiStore'
import { usePluginStore } from '@worldsmith/entity-core'
import { useSettingsStore } from '@/stores/settingsStore'
import { useShortcuts, formatKeysForDisplay } from '@worldsmith/plugin-sdk'
import { useFileSystemProject } from '@/composables/useFileSystemProject'
import { useToast } from '@/composables/useToast'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import { WsIcon } from '@worldsmith/ui-kit'

const uiStore = useUIStore()
const pluginStore = usePluginStore()
const settingsStore = useSettingsStore()
const { register } = useShortcuts()
const { isProjectOpen, dirName, saving, openFolder: doOpenFolder, saveToFolder, lastError } = useFileSystemProject()
const { toastSuccess, toastWarn } = useToast()
const { currentProject } = useProjectSwitcher()

const currentProjectName = computed(() => currentProject.value?.name ?? '')

const hovering = ref(false)
const pinned = ref(false)
const manuallyClosed = ref(false)

const menuVisible = computed(() => (hovering.value || pinned.value) && !manuallyClosed.value)

const currentViewLabel = computed(() => {
  const view = pluginStore.views.find((v) => v.id === uiStore.currentView)
  return view?.label ?? ''
})

function onWrapperEnter() {
  hovering.value = true
  manuallyClosed.value = false
}

function onWrapperLeave() {
  hovering.value = false
}

function togglePin() {
  if (pinned.value) {
    unpin()
  } else {
    pinned.value = true
    manuallyClosed.value = false
  }
}

function unpin() {
  pinned.value = false
  manuallyClosed.value = true
  setTimeout(() => { manuallyClosed.value = false }, 200)
}

function closeMenu() {
  pinned.value = false
  hovering.value = false
  manuallyClosed.value = true
  setTimeout(() => { manuallyClosed.value = false }, 200)
}

onMounted(() => {
  register({
    id: 'menu.import-export',
    keys: settingsStore.getShortcut('menu.import-export'),
    description: '导入/导出',
    scope: 'global',
    handler: () => { window.dispatchEvent(new CustomEvent('ws-open-import-export')) },
  })
})

onUnmounted(() => {})

function openSearch() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-search')) }
function openImportExport() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-import-export')) }
function openBatchEdit() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-batch-edit')) }
function openTemplate() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-template')) }
function openVersion() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-version')) }
function openDocExport() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-doc-export')) }
function openLayoutMgr() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-layout-mgr')) }
function openSettings() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-settings')) }

function openProjectManager() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-project-manager')) }

function openAgentSpace() { closeMenu(); uiStore.setShell('space') }

async function openFolder() {
  closeMenu()
  const ok = await doOpenFolder()
  if (ok) {
    toastSuccess(`已绑定目录：${dirName.value}`)
  } else if (lastError.value) {
    toastWarn(lastError.value)
  }
}

async function saveFolder() {
  closeMenu()
  const ok = await saveToFolder()
  if (ok) {
    toastSuccess('项目已导出到文件夹')
  } else if (lastError.value) {
    toastWarn(lastError.value)
  }
}
</script>

<style scoped>
.menubar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  width: 100%;
  padding: 0 14px;
  background: var(--glass-bg, var(--color-bg-surface));
  border-bottom: 1px solid var(--glass-border, var(--border-color));
  user-select: none;
  flex-shrink: 0;
  position: relative;
  backdrop-filter: blur(var(--glass-blur));
  z-index: 100;
  font-size: 14px;
  line-height: 22px;
  letter-spacing: normal;
  color: #C8E6F0;
}

.menubar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.menubar-title {
  font-weight: var(--font-weight-bold);
  font-size: var(--font-size-base);
  background: var(--gradient-accent);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: 0.3px;
}

.menubar-project-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.menubar-project-switcher:hover {
  background: var(--hover-bg);
}

.menubar-project-name {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menubar-project-chevron {
  font-size: 10px;
  color: var(--text-tertiary);
  margin-top: 1px;
}

.menubar-project {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: var(--hover-bg);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menubar-center {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.menubar-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.menubar-toggle,
.menubar-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-lg);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
}

.menubar-toggle:hover,
.menubar-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.menubar-btn--pinned {
  background: var(--hover-bg);
  color: var(--text-color);
}

.menu-dropdown-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.menu-dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 8px;
  min-width: 220px;
  background: var(--glass-bg, var(--bg));
  border: 1px solid var(--glass-border, var(--border-color));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: 6px;
  z-index: 200;
  backdrop-filter: blur(var(--glass-blur));
}

.menu-dropdown-arrow {
  position: absolute;
  top: -6px;
  right: 10px;
  width: 12px;
  height: 12px;
  background: var(--glass-bg, var(--bg));
  border-left: 1px solid var(--glass-border, var(--border-color));
  border-top: 1px solid var(--glass-border, var(--border-color));
  transform: rotate(45deg);
  z-index: 201;
}

.menu-dropdown-arrow::after {
  content: '';
  position: absolute;
  top: -1px;
  left: -2px;
  width: 14px;
  height: 2px;
  background: var(--glass-bg, var(--bg));
  transform: rotate(-45deg);
}

.menu-dropdown-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-color);
  transition: background var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
}

.menu-item:hover {
  background: var(--gradient-subtle, var(--hover-bg));
  color: var(--accent);
}

.menu-item-icon {
  font-size: var(--font-size-md);
  flex-shrink: 0;
  width: 20px;
  text-align: center;
}

.menu-item-label {
  flex: 1;
  text-align: left;
}

.menu-item-shortcut {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  margin-left: auto;
  padding-left: 16px;
}

.menu-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 8px;
}

.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 150;
}


</style>
