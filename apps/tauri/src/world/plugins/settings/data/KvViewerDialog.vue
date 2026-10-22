<script setup lang="ts">
/**
 * [E 项·键值项只读浏览器]（2026-10-02 存储审计裁定"E 做成只读查看"）
 * 数据源 = 活动存储后端 kvGetAll()（落盘 <项目>/.worldsea/kv_store.json）。
 * 只读：不提供编辑/删除入口；每次打开即拉取最新，不做缓存。
 * 体积与格式化纯函数见 kvViewerFormat.ts。
 */
import { ref, watch } from 'vue'
import TuiModal from '@/components/ui/TuiModal.vue'
import { WsIcon, TuiButton, WsSkeleton } from '@worldsea/ui-kit'
import { storage } from '@worldsea/entity-core'
import { kvValueBytes, prettyKvValue, formatKvBytes } from './kvViewerFormat'

interface KvEntry {
  key: string
  bytes: number
  /** prettyKvValue 预计算结果（load 时一次算好，渲染期不重复处理） */
  isJson: boolean
  text: string
}

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const entries = ref<KvEntry[]>([])
const loading = ref(false)
const loadError = ref('')
const expanded = ref<Set<string>>(new Set())

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const pairs = await storage.kvGetAll()
    entries.value = pairs
      .map(([key, value]) => {
        const pretty = prettyKvValue(value)
        return { key, bytes: kvValueBytes(value), isJson: pretty.isJson, text: pretty.text }
      })
      .sort((a, b) => a.key.localeCompare(b.key))
  } catch (err) {
    console.warn('[KvViewer] 读取键值存储失败:', err)
    loadError.value = String((err as Error)?.message ?? err).slice(0, 160)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      expanded.value = new Set()
      load()
    }
  },
)

function toggle(key: string): void {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
</script>

<template>
  <TuiModal :show="show" title="键值项（只读）" size="md" @close="emit('close')">
    <div class="kvv">
      <div class="kvv-note">
        数据源：&lt;项目&gt;/.worldsea/kv_store.json。键值存储为功能层预留接口（kvSet/kvGet），无写入方时为空，属正常现象。
      </div>

      <div v-if="loading" class="kvv-skeleton">
        <WsSkeleton
          v-for="n in 5"
          :key="n"
          variant="row"
          :lines="1"
          label="正在读取键值存储"
          :aria-hidden="n > 1 || undefined"
        />
      </div>
      <div v-else-if="loadError" class="kvv-err">读取失败：{{ loadError }}</div>
      <div v-else-if="!entries.length" class="kvv-empty">
        当前项目没有键值条目。统计面板中「键值项」为 0 即由此而来，非数据丢失。
      </div>

      <div v-else class="kvv-list">
        <div v-for="en in entries" :key="en.key" class="kvv-item">
          <button type="button" class="kvv-row" @click="toggle(en.key)">
            <WsIcon :name="expanded.has(en.key) ? 'chevron-down' : 'chevron-right'" size="xs" />
            <span class="kvv-key" :title="en.key">{{ en.key }}</span>
            <span v-if="en.isJson" class="kvv-tag">JSON</span>
            <span class="kvv-size">{{ formatKvBytes(en.bytes) }}</span>
          </button>
          <pre v-if="expanded.has(en.key)" class="kvv-value">{{ en.text }}</pre>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="kvv-footer-info">{{ entries.length }} 项 · 只读查看，不支持编辑</span>
      <TuiButton size="sm" variant="secondary" @click="emit('close')">关闭</TuiButton>
    </template>
  </TuiModal>
</template>

<style scoped>
.kvv-note {
  font-size: var(--text-caption-font-size);
  color: var(--color-text-tertiary);
  margin-bottom: 10px;
}
.kvv-skeleton { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
.kvv-skeleton .ws-skeleton { width: 100%; }
.kvv-empty {
  font-size: var(--text-body-sm-font-size);
  color: var(--color-text-tertiary);
  text-align: center;
  padding: 24px 12px;
}
.kvv-err {
  font-size: var(--text-body-sm-font-size);
  color: var(--color-warning);
  padding: 12px;
}
.kvv-list {
  max-height: 50vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kvv-item {
  border-radius: var(--radius-sm);
}
.kvv-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--text-caption-font-size);
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.kvv-row:hover { background: var(--color-bg-hover); }
.kvv-key {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
  color: var(--color-text-primary);
}
.kvv-tag {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: var(--radius-pill, 999px);
  background: var(--color-bg-hover);
  font-size: var(--text-caption-font-size);
  color: var(--color-text-tertiary);
}
.kvv-size {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
}
.kvv-value {
  margin: 0 8px 6px 30px;
  padding: 8px 10px;
  background: var(--color-bg-hover);
  border-radius: var(--radius-sm);
  font-size: var(--text-caption-font-size);
  font-family: var(--font-mono, monospace);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 240px;
  overflow: auto;
  color: var(--color-text-secondary);
}
.kvv-footer-info {
  flex: 1;
  min-width: 0;
  font-size: var(--text-caption-font-size);
  color: var(--color-text-tertiary);
}
</style>
