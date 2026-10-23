<template>
  <Teleport to="body">
    <div class="artifacts-overlay" v-if="show" @click.self="close">
      <div class="artifacts-modal">
        <div class="artifacts-header">
          <h3>产物</h3>
          <div class="artifacts-hdr-actions">
            <span v-if="busy" class="artifacts-busy">
              <WsInlineLoading size="sm" :label="busyLabel" />
              {{ busyLabel }}
            </span>
            <span class="artifacts-count">{{ artifacts.length }} 项</span>
            <TuiButton variant="secondary" size="sm" :disabled="busy" @click="openCreate">+ 新建</TuiButton>
            <button class="artifacts-close" :disabled="busy" @click="close">✕</button>
          </div>
        </div>

        <!-- 新建表单 -->
        <div v-if="creating" class="artifacts-create">
          <input v-model="createTitle" class="input" placeholder="产物标题" />
          <select v-model="createType" class="input select">
            <option value="document">文档</option>
            <option value="chart">图表</option>
            <option value="code">代码</option>
            <option value="other">其他</option>
          </select>
          <textarea v-model="createContent" class="input textarea" rows="4" placeholder="产物内容" />
          <div class="create-actions">
            <TuiButton variant="secondary" size="sm" :disabled="busy" @click="creating = false">取消</TuiButton>
            <TuiButton variant="primary" size="sm" :disabled="busy" @click="doCreate">保存</TuiButton>
          </div>
        </div>

        <div class="artifacts-body" :inert="busy || undefined">
          <!-- 左：产物列表 -->
          <div class="artifacts-list">
            <div
              v-for="a in artifacts"
              :key="a.id"
              class="artifact-item"
              :class="{ active: selected?.id === a.id }"
              @click="select(a)"
            >
              <div class="artifact-item-info">
                <span class="artifact-item-title">{{ a.title }}</span>
                <span class="artifact-item-meta">v{{ a.version }} · {{ typeLabel(a.artifact_type) }}</span>
              </div>
              <div class="artifact-item-actions">
                <TuiButton variant="danger-ghost" size="sm" :disabled="busy" @click.stop="doDelete(a)">删除</TuiButton>
              </div>
            </div>
            <div v-if="artifacts.length === 0" class="artifacts-empty">暂无产物，点击「新建」创建</div>
          </div>

          <!-- 右：预览 -->
          <div class="artifacts-preview">
            <template v-if="selected">
              <div class="preview-header">
                <span class="preview-title">{{ selected.title }}</span>
                <span class="preview-meta">v{{ selected.version }}</span>
                <TuiButton variant="secondary" size="sm" :disabled="busy" @click="openVersions(selected)">历史版本</TuiButton>
              </div>
              <div class="preview-content">{{ selected.content }}</div>
            </template>
            <div v-else class="preview-empty">选择左侧产物以预览</div>
          </div>
        </div>

        <!-- 版本抽屉 -->
        <div v-if="versionsOpen" class="versions-drawer" :inert="busy || undefined">
          <div class="versions-header">
            <span>历史版本 · {{ versionsTarget?.title }}</span>
            <TuiButton variant="secondary" size="sm" :disabled="busy" @click="versionsOpen = false">关闭</TuiButton>
          </div>
          <div class="versions-list">
            <div v-for="v in versions" :key="v.id" class="version-item">
              <span class="version-num">v{{ v.version }}</span>
              <span class="version-date">{{ formatDate(v.created_at) }}</span>
              <TuiButton
                variant="secondary" size="sm"
                :disabled="busy || v.version === selected?.version"
                @click="doRollback(v)"
              >
                {{ v.version === selected?.version ? '当前' : '回滚到此版本' }}
              </TuiButton>
            </div>
            <div v-if="versions.length === 0" class="versions-empty">暂无历史版本</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { TuiButton, WsInlineLoading } from '@worldsea/ui-kit'
import { ref, watch } from 'vue'
import { useArtifacts } from '@worldsea/entity-core'
import type { Artifact, ArtifactVersion } from '@worldsea/entity-core'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const {
  artifacts,
  loadAll,
  create,
  rollback,
  remove,
  getVersions,
} = useArtifacts()

const selected = ref<Artifact | null>(null)
const versionsOpen = ref(false)
const versionsTarget = ref<Artifact | null>(null)
const versions = ref<ArtifactVersion[]>([])
const busy = ref(false)
const busyLabel = ref('')

async function withBusy(label: string, task: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  busyLabel.value = label
  try {
    await task()
  } finally {
    busy.value = false
    busyLabel.value = ''
  }
}

// 新建表单态
const creating = ref(false)
const createTitle = ref('')
const createType = ref('document')
const createContent = ref('')

const TYPE_LABELS: Record<string, string> = {
  document: '文档',
  chart: '图表',
  code: '代码',
  other: '其他',
}
function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

function select(a: Artifact) {
  selected.value = a
  versionsOpen.value = false
}

function openCreate() {
  creating.value = true
  createTitle.value = ''
  createContent.value = ''
  createType.value = 'document'
}

async function doCreate() {
  if (!createTitle.value.trim()) return
  await withBusy('正在保存产物…', async () => {
    await create({
      title: createTitle.value.trim(),
      content: createContent.value,
      artifact_type: createType.value,
    })
    creating.value = false
  })
}

async function openVersions(a: Artifact) {
  await withBusy('正在读取历史版本…', async () => {
    versionsTarget.value = a
    versions.value = await getVersions(a.id)
    versionsOpen.value = true
  })
}

async function doRollback(v: ArtifactVersion) {
  const target = versionsTarget.value
  if (!target) return
  if (confirm(`确定回滚「${target.title}」到 v${v.version}？\n将追加一个新版本，历史完整保留。`)) {
    await withBusy('正在回滚产物…', async () => {
      await rollback(target.id, v.version)
      await loadAll()
      selected.value = artifacts.value.find(a => a.id === target.id) ?? null
      versions.value = await getVersions(target.id)
    })
  }
}

async function doDelete(a: Artifact) {
  if (confirm(`删除产物「${a.title}」及其全部历史版本？`)) {
    await withBusy('正在删除产物…', async () => {
      await remove(a.id)
      if (selected.value?.id === a.id) selected.value = null
      versionsOpen.value = false
    })
  }
}

function close() {
  if (busy.value) return
  emit('close')
}

watch(() => props.show, (v: boolean) => {
  if (v) loadAll()
})
</script>

<style scoped>
.artifacts-overlay { position: fixed; inset: var(--titlebar-height, 32px) 0 0 0; z-index: var(--z-overlay); background: var(--overlay, rgba(0,0,0,0.3)); display: flex; align-items: center; justify-content: center; }
.artifacts-modal { width: 760px; max-width: 92vw; height: 70vh; background: var(--content-bg); border-radius: var(--radius-2xl); box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; position: relative; }
.artifacts-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.artifacts-header h3 { margin: 0; font-size: var(--font-size-lg); }
.artifacts-hdr-actions { display: flex; align-items: center; gap: 12px; }
.artifacts-count { font-size: var(--font-size-sm); color: var(--text-secondary); }
.artifacts-busy { display: inline-flex; align-items: center; gap: 6px; font-size: var(--font-size-xs); color: var(--text-secondary); }
.artifacts-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: var(--radius-xs); }
.artifacts-close:hover { background: var(--hover-bg); }
.artifacts-close:disabled { opacity: var(--disabled-opacity, 0.5); cursor: not-allowed; }
.artifacts-create { display: flex; flex-direction: column; gap: 8px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--bg); }
.input { padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--content-bg); color: var(--text); font-size: var(--font-size-sm); }
.input.select { width: 120px; }
.input.textarea { resize: vertical; font-family: inherit; }
.create-actions { display: flex; justify-content: flex-end; gap: 8px; }
.artifacts-body { display: flex; flex: 1; overflow: hidden; }
.artifacts-list { width: 260px; border-right: 1px solid var(--border); overflow-y: auto; flex-shrink: 0; }
.artifact-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--border); cursor: pointer; }
.artifact-item:hover { background: var(--hover-bg); }
.artifact-item.active { background: color-mix(in srgb, var(--color-primary, #3b82f6) 10%, transparent); }
.artifact-item-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.artifact-item-title { font-weight: var(--font-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artifact-item-meta { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.artifact-item-actions { flex-shrink: 0; margin-left: 8px; }
.artifacts-empty { text-align: center; padding: 30px; color: var(--text-tertiary); font-size: var(--font-size-sm); }
.artifacts-preview { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.preview-header { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-bottom: 1px solid var(--border); }
.preview-title { font-weight: var(--font-weight-semibold); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-meta { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.preview-content { flex: 1; overflow-y: auto; padding: 16px 20px; white-space: pre-wrap; word-break: break-word; font-size: var(--font-size-sm); line-height: 1.6; }
.preview-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-tertiary); font-size: var(--font-size-sm); }
.versions-drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 320px; background: var(--content-bg); border-left: 1px solid var(--border); display: flex; flex-direction: column; box-shadow: -4px 0 16px rgba(0,0,0,0.08); }
.versions-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: var(--font-weight-semibold); }
.versions-list { flex: 1; overflow-y: auto; }
.version-item { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
.version-num { font-weight: var(--font-weight-semibold); flex-shrink: 0; }
.version-date { flex: 1; font-size: var(--font-size-xs); color: var(--text-tertiary); }
.versions-empty { text-align: center; padding: 30px; color: var(--text-tertiary); font-size: var(--font-size-sm); }
</style>