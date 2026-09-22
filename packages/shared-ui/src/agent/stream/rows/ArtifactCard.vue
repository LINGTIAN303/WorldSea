<!--
  ArtifactCard：大结果外置摘要（UX-c）
  - 默认形态：artifact 信封卡（T-d：结果超阈值 → 上下文只留摘要与引用）——字节数 +
    preview 摘要 + 「查看全文」（emit，壳侧经 memory_read_raw 分片取回）；
  - `compact` 形态：截断标注（`原文已外置：raw/<hash>`，A1 己1① 增量外置）的单行引用 chip。
  本组件不做 IPC（shared-ui 不依赖壳）——取回由父层事件上抛。
-->
<template>
  <div v-if="compact" class="wac-chip-row">
    <WsIcon name="book" size="xs" class="wac-chip-icon" />
    <span class="wac-chip-text">原文已外置 raw/{{ hash.slice(0, 8) }}…</span>
    <button type="button" class="wac-view wac-view-sm" @click="emit('view', hash)">查看</button>
  </div>
  <div v-else class="wac-card" :title="note || undefined">
    <div class="wac-head">
      <WsIcon name="book" size="xs" />
      <span class="wac-title">结果过大，已外置</span>
      <span class="wac-bytes">{{ formatBytes(bytes) }}</span>
      <button type="button" class="wac-view" @click="emit('view', hash)">查看全文</button>
    </div>
    <pre v-if="preview" class="wac-preview">{{ preview }}…</pre>
    <div class="wac-hash">raw/{{ hash }}</div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'

defineProps<{
  /** 内容坐标（16 位十六进制，不含 `raw/` 前缀） */
  hash: string
  /** 原文字节数（默认形态展示） */
  bytes?: number
  /** Rust 侧说明文本（默认形态作 tooltip） */
  note?: string
  /** 摘要预览（默认形态展示） */
  preview?: string
  /** 单行引用形态（截断标注用） */
  compact?: boolean
}>()

const emit = defineEmits<{ (e: 'view', hash: string): void }>()

function formatBytes(n?: number): string {
  if (!n || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / 1024 / 1024).toFixed(1)} MiB`
}
</script>

<style scoped>
.wac-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-muted);
  padding: 6px 8px;
}
.wac-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs, 12px);
  color: var(--text-secondary);
}
.wac-title {
  color: var(--text-primary);
  font-weight: 500;
}
.wac-bytes {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted, var(--text-secondary));
}
.wac-view {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--accent);
  font-size: var(--font-size-xs, 12px);
  padding: 1px 8px;
  cursor: pointer;
}
.wac-view:hover {
  border-color: var(--accent);
}
.wac-preview {
  margin: 6px 0 0;
  max-height: 120px;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: var(--font-size-xs, 12px);
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}
.wac-hash {
  margin-top: 4px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  color: var(--text-muted, var(--text-secondary));
}
.wac-chip-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding: 2px 8px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm, 6px);
  font-size: var(--font-size-xs, 12px);
  color: var(--text-secondary);
}
.wac-chip-icon {
  color: var(--text-muted, var(--text-secondary));
}
.wac-view-sm {
  padding: 0 6px;
}
</style>
