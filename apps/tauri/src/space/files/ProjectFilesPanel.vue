<template>
  <div class="pfp" :class="{ 'pfp--docked': layout === 'docked', 'pfp--browser': layout !== 'docked' }">
    <!-- 主区：树（browser 铺满）或 预览（docked 左栏） -->
    <div class="pfp-main">
      <!-- browser 布局：树铺满；选中文件后预览覆盖 -->
      <template v-if="layout !== 'docked'">
        <FileTreeBrowser
          ref="treeRef"
          :root-path="rootPath"
          :compact="compact"
          :title="title"
          :merged-header="mergedHeader"
          class="pfp-tree"
          @select="onSelect"
        />
        <Transition name="pfp-overlay">
          <div v-if="current" class="pfp-overlay">
            <FilePreview :path="current.path" :name="current.name" :size="current.size" @close="current = null" />
          </div>
        </Transition>
      </template>

      <!-- docked 布局：左预览 + 右树 -->
      <template v-else>
        <div class="pfp-dock-preview">
          <FilePreview v-if="current" :path="current.path" :name="current.name" :size="current.size" @close="current = null" />
          <div v-else class="pfp-dock-empty">
            <WsIcon name="file" size="lg" class="pfp-dock-empty-icon" />
            <p class="pfp-dock-empty-text">选择左侧目录树中的文件以预览</p>
          </div>
        </div>
        <div class="pfp-dock-handle" @mousedown.prevent="onDragStart" title="拖拽调整目录树宽度"></div>
        <div class="pfp-dock-tree" :style="{ width: treeWidth + 'px' }">
          <FileTreeBrowser
            ref="treeRef"
            :root-path="rootPath"
            :compact="compact"
            :title="title"
            :merged-header="mergedHeader"
            class="pfp-tree"
            @select="onSelect"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import FileTreeBrowser, { type FsNode } from './FileTreeBrowser.vue'
import FilePreview from './FilePreview.vue'

const props = withDefaults(
  defineProps<{
    rootPath?: string | null
    /** browser=树铺满（预览覆盖）；docked=左预览+右目录树 */
    layout?: 'browser' | 'docked'
    compact?: boolean
    title?: string
    /** 受控选中（外部驱动内部预览，如右栏浮层/左栏唤起联动）；null 不干预 */
    selected?: FsNode | null
    /** inline=点击文件内联预览；external=仅 emit select（左栏，由外部唤起右栏预览） */
    previewMode?: 'inline' | 'external'
    /** 合并头部模式（右栏两层头）：透传内部 FileTreeBrowser，面包屑+工具同一行 */
    mergedHeader?: boolean
  }>(),
  { rootPath: null, layout: 'browser', compact: false, title: '项目目录', selected: null, previewMode: 'inline', mergedHeader: false },
)

const emit = defineEmits<{ select: [node: FsNode] }>()

/** 内部目录树实例（browser/docked 两分支互斥，同一 ref 指向当前渲染者） */
const treeRef = ref<InstanceType<typeof FileTreeBrowser> | null>(null)

/** 转发内部目录树刷新（右栏面板头刷新按钮调用；保留展开状态） */
function refresh(): Promise<void> | undefined {
  return treeRef.value?.refresh()
}

defineExpose({ refresh })

/** 当前预览文件（树与预览状态跨布局保持——单实例，仅 CSS 排布切换） */
const current = ref<FsNode | null>(null)

/** 外部受控选中联动（T12：右栏浮层/左栏唤起 → 主面板预览） */
watch(
  () => props.selected,
  (sel) => {
    if (sel) current.value = sel
  },
)

/** 外部传入的初始选中（首次挂载即应用，兼容挂载时序） */
onMounted(() => {
  if (props.selected) current.value = props.selected
})

/** 目录树栏宽度：默认 200，最小 140，最大 = 默认宽 +25%（≈250） */
const DEFAULT_W = 200
const MIN_W = 140
const MAX_W = Math.round(DEFAULT_W * 1.25)
const treeWidth = ref(DEFAULT_W)

function onSelect(node: FsNode): void {
  if (props.previewMode !== 'external') current.value = node
  emit('select', node)
}

// ── docked 目录树栏拖拽（拖树列左缘 handle）：向左拖 = 树变宽（方向已按直觉修正）──
let dragStartX = 0
let dragStartW = 0

function onDragStart(e: MouseEvent): void {
  dragStartX = e.clientX
  dragStartW = treeWidth.value
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}
function onDragMove(e: MouseEvent): void {
  // 拖树列左缘：向左拖（clientX 减小）→ 树变宽；向右拖 → 树变窄
  const delta = dragStartX - e.clientX
  treeWidth.value = Math.min(MAX_W, Math.max(MIN_W, dragStartW + delta))
}
function onDragEnd(): void {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onMounted(() => {
  // 会话切换（rootPath 变化）时清空当前预览，避免预览旧会话文件
  // （rootPath 由父组件 watch 驱动，此处仅随实例重建；保持简单）
})
</script>

<style scoped>
.pfp {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--color-surface-elevated);
}
.pfp-main {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  position: relative;
  overflow: hidden;
}

/* browser 布局：树铺满 */
.pfp--browser .pfp-tree {
  flex: 1;
  min-width: 0;
  height: 100%;
}

/* 预览覆盖层（browser 布局） */
.pfp-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: var(--color-surface-elevated);
}
.pfp-overlay-enter-active,
.pfp-overlay-leave-active {
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s;
}
.pfp-overlay-enter-from {
  transform: translateX(24%);
  opacity: 0;
}
.pfp-overlay-leave-to {
  transform: translateX(24%);
  opacity: 0;
}

/* docked 布局：左预览 + 右树 */
.pfp-dock-preview {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.pfp-dock-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
}
.pfp-dock-empty-icon {
  color: var(--color-text-tertiary);
  opacity: 0.4;
}
.pfp-dock-empty-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  text-align: center;
}
.pfp-dock-handle {
  width: 4px;
  cursor: col-resize;
  flex-shrink: 0;
  background: transparent;
  transition: background 0.15s;
}
.pfp-dock-handle:hover {
  background: var(--color-primary);
  opacity: 0.35;
}
.pfp-dock-tree {
  flex-shrink: 0;
  height: 100%;
  border-left: 1px solid var(--color-border);
  overflow: hidden;
}
.pfp-dock-tree .pfp-tree {
  height: 100%;
}

/* 动效关闭（data-anim-panels='off'）时覆盖层无位移 */
:root[data-anim-panels='off'] .pfp-overlay-enter-from,
:root[data-anim-panels='off'] .pfp-overlay-leave-to {
  transform: none;
}
</style>