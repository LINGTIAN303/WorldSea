<template>
  <!-- 「⋯ 更多操作」菜单：原 MenuBar 右侧菜单迁移（2026-08-08，MenuBar 整行移除后并入窗口栏）。
       hover 展开 / 点击固定（pin），点外部取消；菜单项通过全局事件分发到 Shell 各处理器 -->
  <div
    class="appmenu"
    @mouseenter="onWrapperEnter"
    @mouseleave="onWrapperLeave"
  >
    <button
      class="appmenu-btn"
      :class="{ 'appmenu-btn--pinned': pinned }"
      aria-label="更多操作"
      title="更多操作"
      @click="togglePin"
    >⋯</button>
    <Transition name="ws-menu">
      <div
        v-if="menuVisible"
        class="appmenu-dropdown"
        role="menu"
      >
        <div class="appmenu-arrow"></div>
        <div class="appmenu-list">
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
          <button class="menu-item" role="menuitem" @click="openTrash">
            <WsIcon name="trash" size="sm" class="menu-item-icon" />
            <span class="menu-item-label">回收站</span>
            <span class="menu-item-shortcut"></span>
          </button>
          <button class="menu-item" role="menuitem" @click="openConsistency">
            <WsIcon name="shield" size="sm" class="menu-item-icon" />
            <span class="menu-item-label">一致性检查</span>
            <span class="menu-item-shortcut"></span>
          </button>
          <button class="menu-item" role="menuitem" @click="openThemeEditor">
            <WsIcon name="palette" size="sm" class="menu-item-icon" />
            <span class="menu-item-label">主题编辑器</span>
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
    <div
      v-if="pinned"
      class="appmenu-overlay"
      @click="unpin"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useShortcuts, formatKeysForDisplay } from '@worldsmith/plugin-sdk'
import { useFileSystemProject } from '@/composables/useFileSystemProject'
import { useToast } from '@/composables/useToast'
import { WsIcon } from '@worldsmith/ui-kit'

const uiStore = useUIStore()
const settingsStore = useSettingsStore()
const { register } = useShortcuts()
const { isProjectOpen, dirName, saving, openFolder: doOpenFolder, saveToFolder, lastError } = useFileSystemProject()
const { toastSuccess, toastWarn } = useToast()

const hovering = ref(false)
const pinned = ref(false)
const manuallyClosed = ref(false)

const menuVisible = computed(() => (hovering.value || pinned.value) && !manuallyClosed.value)

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

function openSearch() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-search')) }
function openImportExport() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-import-export')) }
function openBatchEdit() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-batch-edit')) }
function openTemplate() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-template')) }
function openVersion() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-version')) }
function openDocExport() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-doc-export')) }
function openLayoutMgr() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-layout-mgr')) }
function openTrash() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-trash')) }
function openConsistency() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-consistency')) }
function openThemeEditor() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-theme-editor')) }
function openSettings() { closeMenu(); window.dispatchEvent(new CustomEvent('ws-open-settings')) }

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
.appmenu {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.appmenu-btn {
  width: 34px;
  height: 26px;
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

.appmenu-btn:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.appmenu-btn--pinned {
  background: var(--hover-bg);
  color: var(--text-color);
}

.appmenu-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 220px;
  background: var(--glass-bg, var(--bg));
  border: 1px solid var(--glass-border, var(--border-color));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: 6px;
  z-index: 200;
  backdrop-filter: blur(var(--glass-blur));
}

.appmenu-arrow {
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

.appmenu-arrow::after {
  content: '';
  position: absolute;
  top: -1px;
  left: -2px;
  width: 14px;
  height: 2px;
  background: var(--glass-bg, var(--bg));
  transform: rotate(-45deg);
}

.appmenu-list {
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

.appmenu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 150;
}
</style>
