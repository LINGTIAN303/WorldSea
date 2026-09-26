<template>
  <div class="cdiff">
    <!-- 两侧语义提示条：左=基准（磁盘），右=当前编辑缓冲 -->
    <div class="cdiff-hint">
      <span>左：磁盘内容（基准）</span>
      <span>右：编辑缓冲（当前改动）· 只读审查</span>
    </div>
    <div ref="hostRef" class="cdiff-body"></div>
  </div>
</template>

<!--
  CodeDiff.vue（2026-09-07）：文件改动对比视图——@codemirror/merge 官方包 MergeView。
  左 a=original（磁盘基准），右 b=modified（编辑缓冲），两侧只读（审查用，编辑回编辑器做）；
  差异行高亮 + 未变区折叠。语言/主题与 CodeEditor 同源（cmLangs/cmTheme）。
-->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { MergeView } from '@codemirror/merge'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { cmLangOf } from './cmLangs'
import { wsEditorTheme, wsSyntax } from './cmTheme'

const props = defineProps<{ original: string; modified: string; lang: string }>()

const hostRef = ref<HTMLElement | null>(null)
let mv: MergeView | null = null

onMounted(() => {
  if (!hostRef.value) return
  const lang = cmLangOf(props.lang)
  const common = [wsEditorTheme, wsSyntax, lineNumbers()]
  const readOnly = [EditorView.editable.of(false), EditorState.readOnly.of(true)]
  if (lang) common.push(lang)
  mv = new MergeView({
    a: { doc: props.original, extensions: [...common, ...readOnly] },
    b: { doc: props.modified, extensions: [...common, ...readOnly] },
    parent: hostRef.value,
    // 未变区折叠：上下 3 行上下文，连续未变超 6 行收起——聚焦实际改动
    collapseUnchanged: { margin: 3, minSize: 6 },
  })
})

onBeforeUnmount(() => {
  mv?.destroy()
  mv = null
})
</script>

<style scoped>
.cdiff {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-surface-elevated);
}
.cdiff-hint {
  display: flex;
  justify-content: space-between;
  padding: 4px 12px;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}
.cdiff-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.cdiff-body :deep(.cm-mergeView) {
  height: 100%;
}
.cdiff-body :deep(.cm-editor) {
  height: 100%;
}
.cdiff-body :deep(.cm-scroller) {
  overflow: auto;
}
/* 差异行：弱语义底（改动行/删除块），令牌化适配明暗 */
.cdiff-body :deep(.cm-changedLine) {
  background: var(--color-primary-muted);
}
.cdiff-body :deep(.cm-deletedChunk) {
  background: var(--color-surface);
  text-decoration: line-through;
  text-decoration-color: var(--color-danger, #e5484d);
  text-decoration-thickness: 1px;
}
/* 未变折叠条 */
.cdiff-body :deep(.cm-collapsedSpan) {
  color: var(--color-text-tertiary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  padding: 0 8px;
  font-size: var(--font-size-2xs);
}
</style>
