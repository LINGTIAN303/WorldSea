<!--
  DocxPreview —— Word（.docx）只读预览

  用 docx-preview 做「保真渲染」（CSS-in-JS、分页模拟、内置 sanitizer）。注意其能力边界：
  复杂表格 / 嵌套样式 / 数学公式支持较差，浮动对象与页眉页脚还原有限 —— 这是前端渲染
  Word 的固有上限，不是本组件缺陷（要更高保真只能本机转 PDF）。

  样式容器独立于内容容器：docx-preview 把样式表写进 styleContainer，独立成节点便于随
  预览重渲染 / 卸载一起清掉，不向文档 head 持续堆积样式。
-->
<template>
  <div class="docx-host">
    <div ref="styleEl" class="docx-style-anchor"></div>
    <div v-if="error" class="docx-msg">{{ error }}</div>
    <div v-else ref="bodyEl" class="docx-scroll"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { renderAsync } from 'docx-preview'

const props = defineProps<{ data: ArrayBuffer }>()

const bodyEl = ref<HTMLElement | null>(null)
const styleEl = ref<HTMLElement | null>(null)
const error = ref('')

/** 渲染代次：数据切换 / 卸载后令在途渲染失效，避免旧结果写进新容器 */
let renderToken = 0

async function render(): Promise<void> {
  const token = ++renderToken
  const body = bodyEl.value
  if (!body) return
  error.value = ''
  body.replaceChildren()
  try {
    await renderAsync(props.data, body, styleEl.value ?? undefined, {
      className: 'ws-docx',
      inWrapper: true,
      breakPages: true,
    })
    if (token !== renderToken) return
  } catch (e: unknown) {
    if (token !== renderToken) return
    error.value = 'Word 文档渲染失败：' + (e instanceof Error ? e.message : String(e))
    console.warn('[DocxPreview] 渲染失败:', e)
  }
}

onMounted(render)
watch(() => props.data, render)
onBeforeUnmount(() => {
  renderToken++
})
</script>

<style scoped>
.docx-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
/* 样式锚点：docx-preview 的样式表落在此处，不占布局 */
.docx-style-anchor {
  display: none;
}
.docx-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  /* 页面视图的纸张底衬（docx-preview 为每页设白色纸张，此处只负责页间的衬托） */
  background: var(--color-bg-elevated);
  padding: 12px 0;
}
.docx-scroll :deep(.ws-docx-wrapper) {
  background: transparent;
}
.docx-msg {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
</style>
