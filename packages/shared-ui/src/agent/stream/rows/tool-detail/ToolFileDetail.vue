<!--
  ToolFileDetail：文件类工具展开卡（R 批 R-a）

  按结果形状分派（结构由服务端给）：
    读（结果带 content）→ 带行号只读代码视图（分页 offset 起始行 + 语言高亮 + 行数上限）
    列目录（结果带 entries）→ 目录列表（文件类型图标 / 目录图标 + 大小）
    其余（写 / 改 / 外置 artifact / 无结果）→ 回落通用详情（参数 + 结果），diff 由行级 ToolFileChange 承担
-->
<template>
  <div class="ws-stream-tool-detail ws-file">
    <!-- 读视图 -->
    <template v-if="kind === 'file-read' && read">
      <div class="ws-file-head">
        <FileIcon :name="fileName" class="ws-file-head-icon" />
        <span class="ws-file-head-path" :title="read.path">{{ read.path }}</span>
        <span class="ws-file-head-stat">{{ readStat }}</span>
      </div>
      <div class="ws-file-code">
        <div class="ws-file-code-gutter" aria-hidden="true">
          <span v-for="n in displayedLines.length" :key="n">{{ read.startLine + n - 1 }}</span>
        </div>
        <pre class="ws-file-code-body"><code v-html="codeHtml"></code></pre>
      </div>
      <div v-if="read.cutByLimit" class="ws-file-note">… 仅展示前 {{ MAX_CODE_LINES }} 行（共 {{ read.totalLines }} 行）</div>
      <div v-else-if="read.truncated" class="ws-file-note">… 该页之后仍有内容（可用 offset 继续读取）</div>
    </template>

    <!-- 目录列表 -->
    <template v-else-if="kind === 'file-list' && entries.length">
      <div class="ws-file-head">
        <IconFolder size="14" stroke="1.75" class="ws-file-head-icon" />
        <span class="ws-file-head-path" :title="dirPath">{{ dirPath || '当前目录' }}</span>
        <span class="ws-file-head-stat">{{ entries.length }} 项</span>
      </div>
      <div class="ws-file-list">
        <div v-for="(e, i) in entries" :key="i" class="ws-file-list-row" :style="{ paddingLeft: `${e.depth * 14}px` }">
          <IconFolder v-if="e.isDir" size="13" stroke="1.75" class="ws-file-list-dir" />
          <FileIcon v-else :name="e.name" class="ws-file-list-icon" />
          <span class="ws-file-list-name" :title="e.name">{{ e.base }}</span>
          <span v-if="e.sizeText" class="ws-file-list-size">{{ e.sizeText }}</span>
        </div>
      </div>
    </template>

  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { IconFolder } from '@tabler/icons-vue'
import { FileIcon } from '@worldsea/ui-kit'

import { highlightCode } from '../../../bubbles/codeHighlight'
import { num, parseToolResult, str } from './toolResult'
import type { ToolItem } from './types'

const props = defineProps<{
  item: ToolItem
  /** 展开体种类（由行段统一分派：`detailKindFor`——本组件只渲染，不再判定） */
  kind: 'file-read' | 'file-list'
}>()

/** 代码视图行数上限（超出仅展示前 N 行；全文可经结果区 / artifact 查看） */
const MAX_CODE_LINES = 400

const parsed = computed(() => parseToolResult(props.item.tc.result))

function baseName(p: string): string {
  const norm = p.replace(/\\/g, '/')
  return norm.split('/').filter(Boolean).pop() ?? p
}

// ── 读视图 ──
const read = computed(() => {
  const j = parsed.value.json
  if (!j || typeof j.content !== 'string') return null
  const lines = j.content.split('\n')
  const cut = lines.length > MAX_CODE_LINES
  return {
    path: str(j.path) || str(parsed.value.meta?.path),
    startLine: (num(j.offset) ?? 0) + 1,
    totalLines: num(j.total_lines) ?? lines.length,
    truncated: j.truncated === true,
    cutByLimit: cut,
    lines: cut ? lines.slice(0, MAX_CODE_LINES) : lines,
  }
})
const fileName = computed(() => baseName(read.value?.path ?? ''))
const displayedLines = computed(() => read.value?.lines ?? [])
const readStat = computed(() => {
  const r = read.value
  if (!r) return ''
  const shown = r.lines.length
  return r.startLine > 1 || r.totalLines > shown
    ? `${r.startLine}–${r.startLine + shown - 1} / 共 ${r.totalLines} 行`
    : `${r.totalLines} 行`
})

/** 扩展名 → Prism 语言（未命中 → 纯文本转义） */
function langOf(path: string): string {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    py: 'python', rs: 'rust', json: 'json', md: 'markdown', css: 'css',
    html: 'markup', vue: 'markup', xml: 'markup', yml: 'yaml', yaml: 'yaml',
    sh: 'bash', sql: 'sql', go: 'go', java: 'java',
  }
  return map[ext] ?? ''
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const codeHtml = computed(() => {
  const r = read.value
  if (!r) return ''
  const text = r.lines.join('\n')
  const lang = langOf(r.path)
  return (lang ? highlightCode(text, lang) : null) ?? escapeHtml(text)
})

// ── 目录列表 ──
const dirPath = computed(() => str(parsed.value.json?.path) || str(parsed.value.meta?.path))
const entries = computed(() => {
  const arr = parsed.value.json?.entries
  if (!Array.isArray(arr)) return []
  return arr
    .map((raw) => {
      const e = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const name = str(e.name)
      const size = num(e.size)
      return {
        name,
        base: baseName(name),
        depth: Math.max(0, name.replace(/\\/g, '/').split('/').filter(Boolean).length - 1),
        isDir: e.type === 'dir',
        sizeText: e.type === 'dir' ? '' : size !== undefined ? `${size} B` : '',
      }
    })
    .slice(0, 200)
})
</script>
