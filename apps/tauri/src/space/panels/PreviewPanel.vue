<template>
  <div class="file-panel">
    <!-- 头部：标题 + 资源管理器/刷新/目录树开关（2026-09-03 两层头改造：资源管理器与刷新自树头上移至此） -->
    <div class="fp-header">
      <span class="fp-title"><WsIcon name="files" size="sm" /> 文件</span>
      <div class="fp-header-actions">
        <button class="fp-action-btn" title="在系统文件资源管理器中打开项目目录" :disabled="!root" @click="openInExplorer"><WsIcon name="folder-open" size="sm" /></button>
        <button class="fp-action-btn" title="刷新" @click="refreshTree"><WsIcon name="refresh" size="sm" /></button>
        <button
          ref="treeBtnRef"
          class="fp-action-btn"
          :class="{ active: docked }"
          :title="docked ? '收起目录树' : '展开目录树'"
          @click="toggleDocked"
          @mouseenter="overlayOpen = !docked"
          @mouseleave="overlayOpen = false"
        ><WsIcon name="folder-tree" size="sm" /></button>
      </div>
    </div>

    <!-- 主体：文件浏览器（browser 树铺满 / docked 左预览+右树）；merged-header 两层头 -->
    <div class="fp-body">
      <ProjectFilesPanel
        ref="pfpRef"
        :key="refreshKey"
        :layout="docked ? 'docked' : 'browser'"
        :root-path="root"
        :selected="selected"
        :title="'项目目录'"
        :merged-header="true"
        @select="onSelect"
      />
    </div>

    <!-- hover 浮层目录树（仅未展开时） -->
    <Teleport to="body">
      <Transition name="dropdown">
        <div
          v-if="overlayOpen && !docked"
          class="fp-overlay"
          :style="overlayStyle"
          @mouseenter="overlayOpen = true"
          @mouseleave="overlayOpen = false"
        >
          <FileTreeBrowser
            :root-path="root"
            compact
            title="目录"
            @select="onOverlaySelect"
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { invoke } from '@/agent/composables/transport'
import { useAgent } from '@/agent/composables/useAgent'
import { resolveWorkspaceDir } from '../workspace'
import ProjectFilesPanel from '../files/ProjectFilesPanel.vue'
import FileTreeBrowser, { type FsNode } from '../files/FileTreeBrowser.vue'
import { takePendingFile } from '../files/pendingOpen'

const { currentWorkdir } = useAgent()

const docked = ref(false)
const overlayOpen = ref(false)
const refreshKey = ref(0)
const root = ref<string | null>(null)
const treeBtnRef = ref<HTMLElement>()
const overlayStyle = ref<Record<string, string>>({})

/** 内部文件面板实例（转发目录树刷新） */
const pfpRef = ref<{ refresh: () => Promise<void> } | null>(null)

/** 在系统文件资源管理器中打开项目目录（explorer.exe 对 '/' 分隔路径解析异常，转回反斜杠） */
async function openInExplorer(): Promise<void> {
  if (!root.value) return
  try {
    await invoke('cmd_open_in_explorer', { path: root.value.replace(/\//g, '\\') })
  } catch (err) {
    console.warn('[PreviewPanel] 打开系统文件夹失败:', err)
  }
}

/** 刷新目录树（转发内部 FileTreeBrowser，保留展开状态） */
function refreshTree(): void {
  void pfpRef.value?.refresh()
}

/** 选中文件：用于右栏选中联动（当前仅驱动 FilePreview，无需额外状态） */
const selected = ref<FsNode | null>(null)

function onSelect(node: FsNode): void {
  selected.value = node
}

/** 浮层选择：切换预览并关闭浮层 */
function onOverlaySelect(node: FsNode): void {
  selected.value = node
  overlayOpen.value = false
}

/** click 图标：切换 docked 双栏（目录树从右缘滑出/收起） */
function toggleDocked(): void {
  docked.value = !docked.value
  overlayOpen.value = false
}

/** 锚定浮层到图标位置（右下/左下） */
function positionOverlay(): void {
  const el = treeBtnRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  overlayStyle.value = {
    top: `${Math.max(8, rect.bottom + 6)}px`,
    right: `${Math.max(8, window.innerWidth - rect.right)}px`,
  }
}

async function initRoot(): Promise<void> {
  root.value = currentWorkdir.value ?? (await resolveWorkspaceDir()) ?? null
}

/** 左栏「项目目录」视图点击文件（ws-open-file-preview 事件）→ 本面板预览（T14） */
function onOpenFilePreview(e: Event): void {
  const node = (e as CustomEvent<FsNode>).detail
  if (node) selected.value = node
}

onMounted(async () => {
  await initRoot()
  await nextTick()
  positionOverlay()
  window.addEventListener('ws-open-file-preview', onOpenFilePreview)
  // 挂载前暂存的选择（右栏此前未打开/非 preview tab）：取出即预览（T14 兜底）
  const pending = takePendingFile()
  if (pending) selected.value = pending
})
onBeforeUnmount(() => {
  overlayOpen.value = false
  window.removeEventListener('ws-open-file-preview', onOpenFilePreview)
})

// 会话切换（workdir 变化）时刷新根目录
watch(currentWorkdir, () => {
  void initRoot()
})
</script>

<style scoped>
.file-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--color-surface-elevated);
}
.fp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.fp-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
}
.fp-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.fp-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  cursor: pointer;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.fp-action-btn:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.fp-action-btn.active {
  background: var(--color-primary-muted);
  color: var(--color-primary);
}
.fp-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* hover 浮层 */
.fp-overlay {
  position: fixed;
  width: 260px;
  max-height: 60vh;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  z-index: 10001;
}
.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>