<!--
  ArtifactViewer：外置原文查看器（UX-c）
  工具行「查看全文」/ 截断标注 chip → `useArtifactViewer.viewerHash` → 本弹窗经
  `memory_read_raw` 分片取回（`RawSlice`：content/totalChars/truncated/nextFrom）。
  与 SessionLogPanel 的原文弹窗同语义（同命令同游标）；取回失败明确提示，不静默。
-->
<template>
  <Teleport to="body">
    <div v-if="viewerHash" class="av-backdrop" @click="closeArtifactViewer()"></div>
    <div v-if="viewerHash" class="av-modal" role="dialog" aria-label="外置原文">
      <div class="av-head">
        <span class="av-title">外置原文</span>
        <code class="av-hash">raw/{{ viewerHash }}</code>
        <span class="av-meta">{{ content.length }} / {{ totalChars }} 字符</span>
        <button
          class="av-icon-btn"
          :disabled="!content"
          :title="copied ? '已复制' : '复制全文'"
          aria-label="复制全文"
          @click="copyAll"
        >
          <WsIcon :name="copied ? 'check' : 'copy'" :size="14" :stroke-width="1.7" />
        </button>
        <button class="av-icon-btn" title="关闭" aria-label="关闭" @click="closeArtifactViewer()">
          <WsIcon name="close" :size="14" :stroke-width="1.7" />
        </button>
      </div>
      <div v-if="loading && !content" class="av-empty">加载中…</div>
      <div v-else-if="error" class="av-empty av-error">{{ error }}</div>
      <pre v-else class="av-content">{{ content }}</pre>
      <div v-if="!error && truncated" class="av-foot">
        <button class="av-more" :disabled="loading" @click="loadMore">
          {{ loading ? '加载中…' : '加载更多' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'

import { invoke } from '@/agent/composables/transport'
import { closeArtifactViewer, useArtifactViewer } from '@/agent/composables/useArtifactViewer'

/** 单次取回分片上限（字符；与 SessionLogPanel 同量级——大文件分页取） */
const RAW_CHUNK = 20000

/** `memory_read_raw` 返回切片（RawSlice；serde camelCase） */
interface RawSlice {
  contentHash: string
  content: string
  totalChars: number
  from: number
  truncated: boolean
  nextFrom: number | null
}

const { viewerHash } = useArtifactViewer()

const content = ref('')
const totalChars = ref(0)
const truncated = ref(false)
const nextFrom = ref<number | null>(null)
const loading = ref(false)
const error = ref('')
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function loadFrom(hash: string, from: number): Promise<void> {
  loading.value = true
  try {
    const slice = await invoke<RawSlice>('memory_read_raw', {
      contentHash: hash,
      from,
      maxChars: RAW_CHUNK,
    })
    // 异步回包时用户可能已切到别的坐标 → 丢弃过期结果
    if (viewerHash.value !== hash) return
    content.value = from === 0 ? slice.content : content.value + slice.content
    totalChars.value = slice.totalChars
    truncated.value = slice.truncated
    nextFrom.value = slice.nextFrom
  } catch (e) {
    if (viewerHash.value === hash) error.value = `原文取回失败：${errText(e)}`
  } finally {
    if (viewerHash.value === hash) loading.value = false
  }
}

function loadMore(): void {
  const hash = viewerHash.value
  const from = nextFrom.value
  if (!hash || from == null || loading.value) return
  void loadFrom(hash, from)
}

async function copyAll(): Promise<void> {
  if (!content.value) return
  try {
    await navigator.clipboard.writeText(content.value)
    copied.value = true
    if (copiedTimer !== null) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 剪贴板不可用（权限/环境）——静默降级，不打断阅读 */
  }
}

watch(viewerHash, (hash) => {
  content.value = ''
  totalChars.value = 0
  truncated.value = false
  nextFrom.value = null
  error.value = ''
  copied.value = false
  if (hash) void loadFrom(hash, 0)
})
</script>

<style scoped>
.av-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 10030;
}
.av-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(760px, calc(100vw - 64px));
  height: min(70vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  z-index: 10031;
  overflow: hidden;
}
.av-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.av-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.av-hash {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
}
.av-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted, var(--text-secondary));
  font-variant-numeric: tabular-nums;
}
.av-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.av-icon-btn:hover:not(:disabled) {
  background: var(--bg-muted);
  color: var(--text-primary);
}
.av-icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.av-empty {
  padding: 16px;
  font-size: 12px;
  color: var(--text-muted, var(--text-secondary));
}
.av-error {
  color: var(--danger);
}
.av-content {
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
}
.av-foot {
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  text-align: center;
}
.av-more {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--accent);
  border-radius: var(--radius-sm);
  font-size: 12px;
  padding: 3px 14px;
  cursor: pointer;
}
.av-more:hover:not(:disabled) {
  border-color: var(--accent);
}
.av-more:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
