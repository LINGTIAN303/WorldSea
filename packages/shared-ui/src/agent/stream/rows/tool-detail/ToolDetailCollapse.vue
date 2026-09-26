<!--
  ToolDetailCollapse：通用工具行展开详情（参数 JSON + 结果 + 外置原文卡）

  R 批 R-0 从 ToolRow 拆出；R-a 起折叠外壳（`.ws-stream-tool-collapse`，动画与 aria）
  上移至行段统一持有——本组件只产出内容，供类详情并列复用。
-->
<template>
  <div class="ws-stream-tool-detail" @click.stop>
    <div v-if="hasArgs" class="ws-stream-tool-detail-sec">
      <div class="ws-stream-tool-detail-label">参数</div>
      <pre class="ws-stream-tool-detail-code"><code v-html="argsHtml"></code></pre>
    </div>
    <div v-if="item.tc.result" class="ws-stream-tool-detail-sec">
      <div class="ws-stream-tool-detail-label">结果</div>
      <!-- UX-c：超阈值结果被外置（T-d artifact 信封）→ 摘要卡替代原始 JSON -->
      <ArtifactCard
        v-if="artifact"
        :hash="artifact.hash"
        :bytes="artifact.bytes"
        :note="artifact.note"
        :preview="artifact.preview"
        @view="(h) => emit('view-artifact', h)"
      />
      <pre v-else class="ws-stream-tool-detail-code ws-stream-tool-detail-result"><code v-html="resultHtml"></code></pre>
      <!-- UX-c：截断标注中的增量外置坐标（原文已外置：raw/<hash>）→ 单行引用 chip -->
      <ArtifactCard
        v-for="h in artifact ? [] : externalizedHashes"
        :key="h"
        :hash="h"
        compact
        @view="(h2) => emit('view-artifact', h2)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { highlightCode } from '../../../../markdown'
import ArtifactCard from '../ArtifactCard.vue'
import { extractExternalizedHashes, parseArtifactEnvelope } from '../artifact'
import type { ToolItem } from './types'

const props = defineProps<{
  item: ToolItem
}>()

const emit = defineEmits<{
  /** UX-c：查看外置原文（内容坐标；壳侧经 memory_read_raw 分片取回） */
  (e: 'view-artifact', hash: string): void
}>()

// ===== 参数/结果 JSON 结构化渲染（2026-09-04）：Prism 语法高亮，失败回退转义文本 =====
const hasArgs = computed(() => Object.keys(props.item.tc.args).length > 0)

/** 代码块文本转义回退（高亮器返回 null 时用；Prism 输出已自行转义） */
function escapeHtmlForCode(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 参数 JSON 高亮（保留原无截断展示语义） */
const argsHtml = computed(() => {
  const args = props.item.tc.args
  if (Object.keys(args).length === 0) return ''
  const json = JSON.stringify(args, null, 2)
  return highlightCode(json, 'json') ?? escapeHtmlForCode(json)
})

/** 结果区：JSON 可解析 → prettify + 高亮；纯文本 → 转义原文（沿用原 2000 字符截断） */
const resultHtml = computed(() => {
  const r = props.item.tc.result
  if (!r) return ''
  let parsed: unknown = null
  try {
    parsed = JSON.parse(r)
  } catch {
    parsed = null
  }
  const text = parsed !== null ? JSON.stringify(parsed, null, 2) : r
  const short = text.length > 2000 ? text.slice(0, 1997) + '...' : text
  if (parsed !== null) return highlightCode(short, 'json') ?? escapeHtmlForCode(short)
  return escapeHtmlForCode(short)
})

// ===== UX-c：大结果外置（artifact 信封 / 截断标注） =====

/** 超阈值结果被替换为 artifact 信封（T-d）→ 摘要卡 */
const artifact = computed(() => parseArtifactEnvelope(props.item.tc.result))

/** 截断标注中的增量外置坐标（A1 己1①；原文已外置：raw/<hash>） */
const externalizedHashes = computed(() => extractExternalizedHashes(props.item.tc.result))
</script>
