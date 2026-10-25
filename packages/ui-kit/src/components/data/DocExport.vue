<template>
  <div class="de-overlay" v-if="show" @click.self="close">
    <div class="de-modal" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="de-header">
        <h3><WsIcon name="manuscript" size="sm" /> 文档导出</h3>
        <button class="de-close" @click="close">✕</button>
      </div>
      <div class="de-body">
        <div class="de-options">
          <label><input type="checkbox" v-model="includeEntities" /> 实体</label>
          <label><input type="checkbox" v-model="includeRelations" /> 关系</label>
          <label><input type="checkbox" v-model="includeTimestamps" /> 时间戳</label>
        </div>
        <div class="de-format-toggle">
          <button
            class="de-format-btn"
            :class="{ active: previewFormat === 'html' }"
            @click="previewFormat = 'html'"
          >HTML预览</button>
          <button
            class="de-format-btn"
            :class="{ active: previewFormat === 'markdown' }"
            @click="previewFormat = 'markdown'"
          >Markdown预览</button>
        </div>
        <div class="de-preview">
          <iframe
            v-if="previewFormat === 'html'"
            class="de-preview-iframe"
            :srcdoc="preview"
            sandbox="allow-same-origin"
          ></iframe>
          <iframe
            v-else
            class="de-preview-iframe"
            :srcdoc="renderedMd"
            sandbox="allow-same-origin"
          ></iframe>
          <div v-if="generating" class="de-preview-loading">
            <WsInlineLoading size="md" label="正在生成文档预览" />
            <span>正在生成预览…</span>
          </div>
        </div>
        <div class="de-actions">
          <button class="de-btn" :disabled="generating" @click="downloadHTML"><WsIcon name="item" size="xs" /> 下载 HTML</button>
          <button class="de-btn" :disabled="generating" @click="downloadMarkdown"><WsIcon name="item" size="xs" /> 下载 Markdown</button>
          <button class="de-btn" :disabled="generating" @click="printDoc"><WsIcon name="brush" size="xs" /> 打印</button>
        </div>
      </div>
      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import {
  getExportController,
  defaultFormatEncoder,
  serializerRegistry,
  entitySerializer,
  relationSerializer,
} from '@worldsea/entity-core'
import { useResizable } from '@worldsea/ui-kit'
import WsInlineLoading from '../feedback/loading/WsInlineLoading.vue'
import WsIcon from '../WsIcon.vue'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()
const modalResizable = useResizable({ panelId: 'modal-doc-export', defaultWidth: 640, minWidth: 400 })

const includeEntities = ref(true)
const includeRelations = ref(true)
const includeTimestamps = ref(true)
const previewFormat = ref<'html' | 'markdown'>('html')
const preview = ref('')
const previewMd = ref('')
const generating = ref(false)
let generateToken = 0

/** Markdown 表格块（| 表头 | + |---| 分隔行 + 数据行）→ 单行 <table>；先于逐行替换处理，避免换行转 <br/> 混入单元格 */
function mdTablesToHtml(md: string): string {
  const lines = md.split('\n')
  const isRow = (s: string) => /^\s*\|.*\|\s*$/.test(s)
  const cells = (s: string) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const head = cells(lines[i])
      i += 2
      const body: string[] = []
      while (i < lines.length && isRow(lines[i])) {
        body.push('<tr>' + cells(lines[i]).map(c => `<td>${c}</td>`).join('') + '</tr>')
        i++
      }
      i--
      out.push('<table><tr>' + head.map(c => `<th>${c}</th>`).join('') + '</tr>' + body.join('') + '</table>')
    } else {
      out.push(lines[i])
    }
  }
  return out.join('\n')
}

function mdToHtml(md: string): string {
  let html = mdTablesToHtml(md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/^---$/gm, '<hr/>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>')
  html = '<p>' + html + '</p>'
  html = html.replace(/<p><\/p>/g, '').replace(/<p>(<h[1-3]>)/g, '$1').replace(/(<\/h[1-3]>)<\/p>/g, '$1')
  html = html.replace(/<p>(<ul>)/g, '$1').replace(/(<\/ul>)<\/p>/g, '$1')
  html = html.replace(/<p>(<hr\/>)<\/p>/g, '$1')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#222;line-height:1.7}h1{border-bottom:2px solid #e5e7eb;padding-bottom:8px}h2{border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-top:24px}h3{margin-top:20px}ul{padding-left:20px}li{margin:4px 0}hr{border:none;border-top:1px solid #e5e7eb;margin:20px 0}strong{color:#111}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #e5e7eb;padding:6px 10px;text-align:left;font-size:13px}th{background:#f3f4f6}</style></head><body>${html}</body></html>`
}

const renderedMd = computed(() => mdToHtml(previewMd.value))

async function generatePack() {
  const token = ++generateToken
  generating.value = true
  try {
    serializerRegistry.clear()
    serializerRegistry.register(entitySerializer)
    serializerRegistry.register(relationSerializer)

    const ec = getExportController()
    const selected: string[] = []
    if (includeEntities.value) selected.push('entities')
    if (includeRelations.value) selected.push('relations')
    const pack = await ec.collectAll(selected.length > 0 ? selected : undefined)
    if (token !== generateToken) return

    const html = defaultFormatEncoder.encodeHTML(pack, {
      includeTimestamps: includeTimestamps.value,
      title: 'WorldSea 设定文档',
    })
    preview.value = html

    const md = defaultFormatEncoder.encodeMarkdown(pack, {
      includeTimestamps: includeTimestamps.value,
    })
    previewMd.value = md
  } catch (err) {
    if (token === generateToken) {
      preview.value = ''
      previewMd.value = ''
      console.warn('[DocExport] 生成预览失败:', err)
    }
  } finally {
    if (token === generateToken) generating.value = false
  }
}

watch([includeEntities, includeRelations, includeTimestamps], generatePack, { immediate: true })

function downloadHTML() {
  if (generating.value) return
  const html = preview.value
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'worldsea-doc.html'; a.click()
  URL.revokeObjectURL(url)
}

function downloadMarkdown() {
  if (generating.value) return
  const md = previewMd.value
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'worldsea-doc.md'; a.click()
  URL.revokeObjectURL(url)
}

function printDoc() {
  if (generating.value) return
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(preview.value)
  win.document.close()
  setTimeout(() => win.print(), 500)
}

function close() { emit('close') }
</script>

<style scoped>
.de-overlay { position: fixed; inset: var(--titlebar-height, 32px) 0 0 0; z-index: var(--z-overlay); background: var(--color-overlay); display: flex; align-items: center; justify-content: center; }
.de-modal { position: relative; max-height: 80vh; background: var(--content-bg, #fff); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.de-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border, #eee); }
.de-header h3 { margin: 0; font-size: var(--font-size-lg); }
.de-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.de-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.de-options { display: flex; gap: 16px; margin-bottom: 12px; font-size: var(--font-size-base); cursor: pointer; }
.de-options label { cursor: pointer; }
.de-format-toggle { display: flex; gap: 0; margin-bottom: 12px; border: 1px solid var(--border, #ddd); border-radius: var(--radius-sm); overflow: hidden; }
.de-format-btn { padding: 6px 16px; border: none; background: var(--bg-tertiary, #f0f0f0); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-secondary, #666); transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s, filter 0.2s; }
.de-format-btn:not(:last-child) { border-right: 1px solid var(--border, var(--color-border)); }
.de-format-btn.active { background: var(--accent, #4a90d9); color: #fff; }
.de-format-btn:hover:not(.active) { background: var(--bg-secondary, #e8e8e8); }
.de-preview { position: relative; }
.de-preview-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--content-bg, #fff) 78%, transparent);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
  pointer-events: none;
}
.de-preview-iframe { width: 100%; height: 360px; border: 1px solid var(--border, #ddd); border-radius: var(--radius-sm); background: #fff; }
.de-preview textarea { width: 100%; border: 1px solid var(--border, #ddd); border-radius: var(--radius-sm); padding: 8px; font-size: var(--font-size-sm); font-family: monospace; background: var(--bg, #fafafa); resize: vertical; }
.de-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.de-btn { padding: 8px 20px; border: 1px solid var(--border, #ddd); border-radius: var(--radius-sm); background: var(--bg, #f8f8f8); cursor: pointer; font-size: var(--font-size-base); }
.de-btn:hover { background: var(--color-bg-hover); }
.de-btn:disabled { opacity: var(--disabled-opacity, 0.5); cursor: not-allowed; }
.resize-handle-right {
  position: absolute;
  right: 0;
  top: 0;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.resize-handle-right:hover,
.resize-handle-right:active {
  background: var(--primary);
  opacity: 0.3;
}
</style>
