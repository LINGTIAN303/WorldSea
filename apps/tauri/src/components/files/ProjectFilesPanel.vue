<template>
  <div class="pfp" :class="{ 'pfp--docked': layout === 'docked', 'pfp--browser': layout !== 'docked' }">
    <!-- 主区：树（browser 铺满）或 预览（docked 左栏） -->
    <div class="pfp-main">
      <!-- browser 布局：树铺满；有打开文件时预览覆盖（多实例 v-show 切换） -->
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
          <div v-if="activePath" class="pfp-overlay">
            <div class="pfp-tab-body">
              <FilePreview
                v-for="t in tabs"
                v-show="t.path === activePath"
                :key="t.path"
                :ref="setPreviewRef(t.path)"
                :path="t.path"
                :name="t.name"
                :size="t.size"
                @close="removeTab(t.path)"
                @dirty-change="v => onDirtyChange(t.path, v)"
              />
            </div>
          </div>
        </Transition>
      </template>

      <!-- docked 布局：左预览（多实例 v-show 切换）+ 右树 -->
      <template v-else>
        <div class="pfp-dock-preview">
          <div v-if="activePath" class="pfp-tab-body">
            <FilePreview
              v-for="t in tabs"
              v-show="t.path === activePath"
              :key="t.path"
              :ref="setPreviewRef(t.path)"
              :path="t.path"
              :name="t.name"
              :size="t.size"
              @close="removeTab(t.path)"
              @dirty-change="v => onDirtyChange(t.path, v)"
            />
          </div>
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
import { ref, computed, watch, onMounted } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import FileTreeBrowser, { type FsNode } from './FileTreeBrowser.vue'
import FilePreview from './FilePreview.vue'
import { fileTabsState, resetFileTabs } from './fileTabsStore'

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
    /** 多文件栏拥有者（右栏主面板）：读写会话级 fileTabsState；左栏实例恒不写入 */
    ownsTabs?: boolean
  }>(),
  { rootPath: null, layout: 'browser', compact: false, title: '项目目录', selected: null, previewMode: 'inline', mergedHeader: false, ownsTabs: false },
)

const emit = defineEmits<{ select: [node: FsNode] }>()

/** 内部目录树实例（browser/docked 两分支互斥，同一 ref 指向当前渲染者） */
const treeRef = ref<InstanceType<typeof FileTreeBrowser> | null>(null)

/** 转发内部目录树刷新（右栏面板头刷新按钮调用；保留展开状态） */
function refresh(): Promise<void> | undefined {
  return treeRef.value?.refresh()
}

defineExpose({ refresh, closeTab })

/** 多文件栏状态：会话级单例（fileTabsState）——右栏五 Tab 切换（PreviewPanel 卸载重挂）后
 *  tabs/activePath/脏标记/编辑缓冲全部保留（2026-09-07 修复「切 Tab 丢 tab」）。
 *  非拥有者实例（左栏 external）只读且恒空。 */
const tabs = computed(() => fileTabsState.tabs)
const activePath = computed<string | null>({
  get: () => fileTabsState.activePath,
  set: (v) => { fileTabsState.activePath = v },
})
const dirtyPaths = fileTabsState.dirtyPaths
/** 编辑缓冲存取（FilePreview 持久化用；非拥有者实例不会走到） */
const buffers = fileTabsState.buffers

/** FilePreview 实例表（tab× 关闭时调用 tryClose 三键确认防丢稿） */
const previewRefs = new Map<string, InstanceType<typeof FilePreview> | null>()

function setPreviewRef(path: string) {
  return (el: unknown) => {
    if (el) previewRefs.set(path, el as InstanceType<typeof FilePreview>)
    else previewRefs.delete(path)
  }
}

/** 打开/激活文件：已开则切过去，未开则入列 */
function openTab(node: FsNode): void {
  if (!fileTabsState.tabs.some(t => t.path === node.path)) fileTabsState.tabs.push({ ...node })
  fileTabsState.activePath = node.path
}

/** tab× 关闭：先经 FilePreview 三键确认（保存/放弃/继续编辑），取消则留在原地；
 *  返回 false=用户取消（标题「回到文件区」的批量关闭依赖此值中断流程） */
async function closeTab(path: string): Promise<boolean> {
  const inst = previewRefs.get(path)
  if (inst && !(await inst.tryClose())) return false
  removeTab(path)
  return true
}

/** 已确认移除（FilePreview 返回按钮 close 事件）；关闭的是激活 tab 时激活邻位 */
function removeTab(path: string): void {
  const idx = fileTabsState.tabs.findIndex(t => t.path === path)
  if (idx < 0) return
  fileTabsState.tabs.splice(idx, 1)
  dirtyPaths.delete(path)
  buffers.delete(path)
  if (fileTabsState.activePath === path) {
    const next = fileTabsState.tabs[Math.min(idx, fileTabsState.tabs.length - 1)]
    fileTabsState.activePath = next?.path ?? null
  }
}

function onDirtyChange(path: string, v: boolean): void {
  if (v) dirtyPaths.add(path)
  else dirtyPaths.delete(path)
}

/** 外部受控选中联动（T12：右栏浮层/左栏唤起 → 主面板预览）。
 *  以 path 为比较键（对象引用浅比较会被同引用重复点击静默跳过，2026-09-07 修复「点击无反应」） */
watch(
  () => props.selected?.path ?? null,
  (p) => {
    if (p && props.selected) openTab(props.selected)
  },
)

/** 外部传入的初始选中（首次挂载即应用，兼容挂载时序） */
onMounted(() => {
  if (props.selected) openTab(props.selected)
})

/** 会话切换（rootPath 变化）时清空 tabs，避免串会话文件（仅拥有者有权清） */
watch(
  () => props.rootPath,
  (p, old) => {
    if (props.ownsTabs && p !== old) resetFileTabs()
  },
)

/** 目录树栏宽度：默认 200，最小 140，最大 = 默认宽 +25%（≈250） */
const DEFAULT_W = 200
const MIN_W = 140
const MAX_W = Math.round(DEFAULT_W * 1.25)
const treeWidth = ref(DEFAULT_W)

function onSelect(node: FsNode): void {
  if (props.previewMode !== 'external') openTab(node)
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

/* 预览覆盖层（browser 布局）：文件体（tab 条已迁移至面板头部行） */
.pfp-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: var(--color-surface-elevated);
  display: flex;
  flex-direction: column;
}
/* tab 下文件体：多实例 v-show 切换，每个占满 */
.pfp-tab-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pfp-tab-body > :deep(.fpv) {
  flex: 1;
  min-height: 0;
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

/* docked 布局：左预览（tab 条 + 文件体竖排）+ 右树 */
.pfp-dock-preview {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
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