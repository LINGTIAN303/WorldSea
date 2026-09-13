<!--
  PdfPreview —— PDF 只读预览（pdfjs-dist → canvas 逐页渲染）

  两个容易踩的点，均已处理：
  1. **Worker 必须显式建**：pdfjs 默认 `workerSrc = ''` 会回退主线程同步解析，大文件卡死 UI
     （见 pdfjsSetup.ts，与 Agent 附件提取共用同一初始化）。
  2. **传给 getDocument 的必须是副本**：pdfjs 会把 data **转移（detach）** 给 worker，
     直接传 props.data 会让该 ArrayBuffer 变空 —— 二次渲染（如切换视图后回来）即白屏。

  渲染策略：按容器宽度自适应缩放（fit-width）+ 逐页 canvas（dpr 上限 2，避免 4K 屏爆内存）；
  页数封顶 MAX_PAGES 并在底部如实提示（不静默截断）。
-->
<template>
  <div class="pdf-host">
    <div v-if="error" class="pdf-msg">{{ error }}</div>
    <div v-else ref="scrollEl" class="pdf-scroll"></div>
    <div v-if="!error && truncated" class="pdf-note">
      仅预览前 {{ MAX_PAGES }} 页（共 {{ totalPages }} 页）
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ensurePdfWorker } from './pdfjsSetup'

/** 页数上限：逐页 canvas 渲染，超大文档全量渲染会明显吃内存 */
const MAX_PAGES = 50

const props = defineProps<{ data: ArrayBuffer }>()

const scrollEl = ref<HTMLElement | null>(null)
const error = ref('')
const totalPages = ref(0)
const truncated = ref(false)

/** 渲染代次：数据切换 / 卸载后令在途渲染失效，避免旧文档写进新容器 */
let renderToken = 0
/** 当前文档句柄，切换或卸载时释放（worker 侧资源） */
let currentDoc: { destroy: () => Promise<void> } | null = null

function disposeDoc(): void {
  if (currentDoc) {
    void currentDoc.destroy().catch(() => { /* 已销毁/在途时忽略 */ })
    currentDoc = null
  }
}

async function render(): Promise<void> {
  const token = ++renderToken
  const host = scrollEl.value
  if (!host) return
  error.value = ''
  truncated.value = false
  totalPages.value = 0
  host.replaceChildren()
  disposeDoc()

  try {
    const pdfjsLib = await ensurePdfWorker()
    if (token !== renderToken) return
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(props.data.slice(0)) }).promise
    if (token !== renderToken) {
      void pdf.destroy().catch(() => {})
      return
    }
    currentDoc = pdf
    totalPages.value = pdf.numPages
    const count = Math.min(pdf.numPages, MAX_PAGES)
    truncated.value = pdf.numPages > count

    // 以容器可用宽度做 fit-width；上限 3 倍避免小页被放得过大
    const availWidth = Math.max(host.clientWidth - 24, 0)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    for (let i = 1; i <= count; i++) {
      if (token !== renderToken) return
      const page = await pdf.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const fit = availWidth > 0 ? availWidth / base.width : 1
      const cssScale = Math.min(Math.max(fit, 0.3), 3)
      const viewport = page.getViewport({ scale: cssScale * dpr })

      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-page'
      canvas.width = Math.max(1, Math.floor(viewport.width))
      canvas.height = Math.max(1, Math.floor(viewport.height))
      canvas.style.width = `${Math.floor(base.width * cssScale)}px`
      canvas.style.height = `${Math.floor(base.height * cssScale)}px`
      host.appendChild(canvas)

      await page.render({ canvas, viewport }).promise
    }
  } catch (e: unknown) {
    if (token !== renderToken) return
    error.value = 'PDF 渲染失败：' + (e instanceof Error ? e.message : String(e))
    console.warn('[PdfPreview] 渲染失败:', e)
  }
}

onMounted(render)
watch(() => props.data, render)
onBeforeUnmount(() => {
  renderToken++
  disposeDoc()
})
</script>

<style scoped>
.pdf-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.pdf-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: var(--color-bg-elevated);
}
.pdf-scroll :deep(.pdf-page) {
  display: block;
  max-width: 100%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}
.pdf-note {
  flex-shrink: 0;
  padding: 6px 10px;
  border-top: 1px solid var(--color-border);
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  text-align: center;
}
.pdf-msg {
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
