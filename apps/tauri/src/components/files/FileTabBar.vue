<template>
  <div ref="stripRef" class="pfp-filetabs" @wheel.prevent="onWheel">
    <button
      v-for="t in tabs"
      :key="t.path"
      class="pfp-tab"
      :class="{ on: t.path === activePath }"
      :title="t.path"
      @click="emit('activate', t.path)"
    >
      <FileIcon :name="t.name" class="pfp-tab-icon" />
      <span class="pfp-tab-name">{{ t.name }}</span>
      <span v-if="dirtyPaths.has(t.path)" class="pfp-tab-dot" title="有未保存的修改" />
      <span class="pfp-tab-close" title="关闭" @click.stop="emit('close', t.path)"><WsIcon name="close" size="xs" /></span>
    </button>
  </div>
</template>

<!--
  FileTabBar.vue（2026-09-07 多文件栏，同日迁移至文件面板头部行）：
  挂载于 PreviewPanel 头部 #fp-header-tabs 容器（ProjectFilesPanel 经 Teleport 传入）——
  激活=文字亮+底边主色；脏点=有未保存修改（dirtyPaths 由各 FilePreview dirty-change 汇聚）；
  × 关闭走 ProjectFilesPanel.closeTab（先经 FilePreview.tryClose 三键确认防丢稿）。
  横向溢出可滚（滚轮纵向转横向），按需求不显示滚动条。
-->
<script setup lang="ts">
import { ref } from 'vue'
import { FileIcon, WsIcon } from '@worldsea/ui-kit'
import type { FsNode } from './FileTreeBrowser.vue'

defineProps<{
  tabs: FsNode[]
  activePath: string | null
  dirtyPaths: Set<string>
}>()

const emit = defineEmits<{ activate: [path: string]; close: [path: string] }>()

const stripRef = ref<HTMLElement | null>(null)

/** 滚轮纵向量转横向滚动（溢出时可滚且无滚动条，2026-09-07 用户需求） */
function onWheel(e: WheelEvent): void {
  const el = stripRef.value
  if (!el) return
  el.scrollLeft += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX)
}
</script>

<style scoped>
.pfp-filetabs {
  display: flex;
  align-items: stretch;
  gap: 1px;
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none; /* 需求：可横向滚动但不显示滚动条 */
}
.pfp-filetabs::-webkit-scrollbar {
  display: none;
}
.pfp-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px 3px 8px;
  max-width: 160px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.pfp-tab:hover {
  color: var(--color-text);
  background: var(--color-surface);
}
.pfp-tab.on {
  color: var(--color-text);
  border-bottom-color: var(--color-primary);
  font-weight: 600;
}
.pfp-tab-icon {
  flex-shrink: 0;
}
.pfp-tab-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 脏点：与 FilePreview 头部脏点同款橙色 */
.pfp-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-warning, #e8a33d);
  flex-shrink: 0;
}
.pfp-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: var(--radius-xs);
  color: var(--color-text-tertiary);
  opacity: 0.6;
  flex-shrink: 0;
}
.pfp-tab-close:hover {
  background: var(--color-primary-muted);
  color: var(--color-text);
  opacity: 1;
}
</style>
