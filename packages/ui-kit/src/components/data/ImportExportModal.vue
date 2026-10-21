<template>
  <div class="ie-overlay" v-if="show" @click.self="close">
    <div class="ie-modal" ref="boxRef" role="dialog" aria-modal="true" aria-label="导入导出数据" tabindex="-1" :style="{ width: modalResizable.width.value + 'px' }">
      <div class="ie-header">
        <h3>{{ mode === 'export' ? '导出数据' : '导入数据' }}</h3>
        <button class="ie-close" @click="close">✕</button>
      </div>
      <div class="ie-body">
        <div class="ie-tabs">
          <button :class="{ active: mode === 'export' }" @click="mode = 'export'">导出</button>
          <button :class="{ active: mode === 'import' }" @click="mode = 'import'">导入</button>
        </div>

        <!-- ═══════ 导出 ═══════ -->
        <div v-if="mode === 'export'" class="ie-section">
          <!-- 格式 -->
          <div class="ie-fmt">
            <label><input type="radio" v-model="exportFormat" value="json" /> JSON</label>
            <label><input type="radio" v-model="exportFormat" value="yaml" /> YAML</label>
            <label><input type="radio" v-model="exportFormat" value="ws" /> .ws 包（含媒体）</label>
          </div>

          <!-- 选择导出的内容 -->
          <div class="ie-scope">
            <h4>导出内容</h4>
            <div class="ie-scope-grid">
              <label
                v-for="s in availableSerializers"
                :key="s.id"
                class="ie-scope-item"
                :class="{ disabled: s.id === 'views' }"
              >
                <input type="checkbox" v-model="selectedSerializers" :value="s.id" />
                <WsIcon class="scope-icon" :name="serializerIcon(s.id)" size="xs" />
                <span class="scope-label">{{ s.label }}</span>
              </label>
            </div>
            <p class="ie-hint">视图注册由各芽激活时重建，不可单独勾选</p>
          </div>

          <!-- 预览 -->
          <div class="ie-preview">
            <textarea readonly :value="exportPreview" rows="10"></textarea>
            <div v-if="previewGenerating" class="ie-preview-loading">
              <WsInlineLoading size="md" label="正在生成导出预览" />
              <span>正在生成预览…</span>
            </div>
          </div>

          <p v-if="exportError" class="ie-error">{{ exportError }}</p>

          <div class="ie-actions">
            <TuiButton variant="secondary" @click="close">取消</TuiButton>
            <TuiButton variant="primary" @click="doExport" :disabled="exporting">
              {{ exporting ? '导出中...' : `下载 ${exportFormat.toUpperCase()}` }}
            </TuiButton>
          </div>
        </div>

        <!-- ═══════ 导入 ═══════ -->
        <div v-if="mode === 'import'" class="ie-section">
          <!-- 文件选择 -->
          <div class="ie-upload" @dragover.prevent @drop.prevent="onFileDrop">
            <input type="file" accept=".json,.yaml,.yml,.ws" @change="onFileChange" ref="fileInput" hidden />
            <div v-if="parsing" class="ie-dropzone ie-dropzone--loading">
              <WsInlineLoading size="lg" label="正在解析导入文件" />
              <p>正在解析文件…</p>
            </div>
            <div v-else-if="!importPack" class="ie-dropzone" @click="fileInput?.click()">
              <WsIcon class="dz-icon" name="folder" size="lg" />
              <p>点击选择文件，或拖拽 JSON / YAML 文件到此处</p>
            </div>
            <div v-else class="ie-file-info">
              <WsIcon class="fi-icon" name="manuscript" size="md" />
              <div class="fi-detail">
                <strong>{{ importFileName }}</strong>
                <span class="fi-meta">{{ importManifest?.exportedAt ?? '' }} · v{{ importManifest?.version }}</span>
              </div>
              <button class="fi-clear" @click="clearImport">✕</button>
            </div>
          </div>

          <!-- 导入概览 -->
          <div class="ie-summary" v-if="importPack">
            <h4>包含的内容</h4>
            <div class="ie-summary-grid">
              <div v-for="(data, key) in importPack.serializers" :key="key" class="is-item">
                <WsIcon class="is-icon" :name="serializerIcon(key)" size="xs" />
                <span class="is-label">{{ serializerLabel(key) }}</span>
                <span class="is-count">{{ itemCount(data) }} 项</span>
              </div>
            </div>
          </div>

          <!-- 导入策略 -->
          <div class="ie-strategy" v-if="importPack">
            <h4>导入策略</h4>
            <label><input type="radio" v-model="importStrategy" value="overwrite" /> 覆盖 — 清空现有数据后导入</label>
            <label><input type="radio" v-model="importStrategy" value="merge" /> 合并 — 按 ID 去重，新增或更新</label>
          </div>

          <!-- 覆盖确认 -->
          <div class="ie-overwrite-warn" v-if="importPack && importStrategy === 'overwrite' && !overwriteConfirmed">
            <p class="ie-warn-text">覆盖模式将清空所有现有数据！建议先备份。</p>
            <div class="ie-warn-actions">
              <TuiButton variant="secondary" :disabled="backupBusy" @click="doBackupFirst">
                <WsInlineLoading v-if="backupBusy" size="sm" label="正在备份" />
                {{ backupBusy ? '备份中…' : '先备份再导入' }}
              </TuiButton>
              <label class="ie-warn-check">
                <input type="checkbox" v-model="overwriteConfirmed" />
                我已了解风险，确认覆盖
              </label>
            </div>
          </div>
          <div class="ie-backup-info" v-if="importPack && importStrategy === 'overwrite' && backupInfo && overwriteConfirmed">
            <span v-if="backupInfo.truncated" class="ie-backup-warn">备份仅含元数据（数据超过5MB限制），无法用于恢复！建议先手动导出完整备份</span>
            <span v-else class="ie-backup-ok">已有备份（{{ backupInfo.entityCount }} 实体, {{ backupInfo.relationCount }} 关系, {{ backupInfo.hasFullData ? '完整' : '仅元数据' }}）</span>
          </div>

          <!-- 导入错误 -->
          <p v-if="importError" class="ie-error">{{ importError }}</p>

          <!-- 导入报告 -->
          <div v-if="importReport" class="ie-report">
            <h4>导入结果</h4>
            <div :class="'ie-report-status ' + (importReport.success ? 'success' : 'fail')">
              <WsIcon v-if="importReport.success" name="check" size="xs" /> <WsIcon v-else name="close" size="xs" />
              {{ importReport.success ? '导入成功' : '导入失败' }}
            </div>
            <div v-for="item in importReport.items" :key="item.serializerId" class="ir-item">
              <span class="ir-label">{{ serializerLabel(item.serializerId) }}</span>
              <span class="ir-stat">+{{ item.added }} / ~{{ item.updated }} / -{{ item.skipped }}</span>
              <span v-if="item.errors.length" class="ir-err">{{ item.errors[0] }}</span>
            </div>
          </div>

          <div class="ie-actions" v-if="!importReport">
            <TuiButton variant="secondary" @click="close">取消</TuiButton>
            <TuiButton variant="danger-ghost" @click="doImport" :disabled="!importPack || importing || parsing || (importStrategy === 'overwrite' && !overwriteConfirmed)">
              {{ importing ? '导入中...' : '导入数据' }}
            </TuiButton>
          </div>
          <div class="ie-actions" v-else>
            <TuiButton variant="primary" @click="close">完成</TuiButton>
          </div>
        </div>
      </div>

      <WsLoadingOverlay
        :show="exportVisible"
        scope="panel"
        title="正在导出"
        success-title="导出完成"
        error-title="导出失败"
        :stages="exportStages"
        :current="exportStage"
        :status="exportOverlayStatus"
        :target="`格式：${exportFormat.toUpperCase()}`"
        :error="exportErrorText"
        error-text="导出没有完成"
        success-text="文件已开始下载"
        success-detail="可以继续操作"
        @retry="doExport"
        @close="closeExportOverlay"
      />

      <WsLoadingOverlay
        :show="importVisible"
        scope="panel"
        title="正在导入"
        success-title="导入完成"
        error-title="导入失败"
        :stages="importStages"
        :current="importStage"
        :status="importOverlayStatus"
        :target="importFileName ? `文件：${importFileName}` : ''"
        :error="importErrorText"
        error-text="导入没有完成"
        success-text="报告已生成"
        success-detail="可以继续操作"
        @retry="doImport"
        @close="closeImportOverlay"
      />

      <div class="resize-handle-right" @mousedown="modalResizable.onResizeStart"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import {
  useEntityStore,
  useRelationStore,
  usePluginStore,
  fieldRegistry,
  getExportController,
  getImportController,
  serializerRegistry,
  useAutoBackup,
  type WorldSeaPack,
  type ImportStrategy,
  type ImportReport,
} from '@worldsea/entity-core'
import { TuiButton, useResizable, useModalShortcuts } from '@worldsea/ui-kit'
import WsLoadingOverlay from '../feedback/loading/WsLoadingOverlay.vue'
import WsInlineLoading from '../feedback/loading/WsInlineLoading.vue'
import { useAsyncTask } from '../../composables/useAsyncTask'
import type { LoadingStage } from '../feedback/loading/types'
import WsIcon from '../WsIcon.vue'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const boxRef = ref<HTMLElement>()
/** 打开前的焦点元素：关闭后还原 */
let returnFocusEl: HTMLElement | null = null

// Esc 关闭收编 useModalShortcuts（modal 层）
useModalShortcuts(() => props.show, { id: 'import-export.close', onEscape: () => close() })
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// 焦点陷阱：Tab 仅在弹窗内循环（Esc 已收编注册表）
function onKeydown(e: KeyboardEvent) {
  if (!props.show) return
  if (e.key === 'Tab') {
    const box = boxRef.value
    if (!box) return
    const focusables = box.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(() => props.show, (v) => {
  if (v) {
    returnFocusEl = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown) // Tab 焦点陷阱（Esc 已收编注册表）
    nextTick(() => {
      const first =
        boxRef.value?.querySelector<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ) ?? boxRef.value
      first?.focus({ preventScroll: true })
    })
  } else {
    window.removeEventListener('keydown', onKeydown)
    returnFocusEl?.focus?.({ preventScroll: true })
    returnFocusEl = null
  }
})


const modalResizable = useResizable({ panelId: 'modal-import-export', defaultWidth: 600, minWidth: 360, side: 'right' })

/* ─── stores ─── */
const entityStore = useEntityStore()
const relationStore = useRelationStore()
const pluginStore = usePluginStore()
const { createBackup, getBackupInfo } = useAutoBackup()

/* ─── 状态 ─── */
const mode = ref<'export' | 'import'>('export')
const exportFormat = ref<'json' | 'yaml' | 'ws'>('json')
const exporting = ref(false)
const importing = ref(false)
const parsing = ref(false)
const importStrategy = ref<ImportStrategy>('overwrite')
const importError = ref('')
const exportError = ref('')
const importReport = ref<ImportReport | null>(null)
const overwriteConfirmed = ref(false)
const backupInfo = ref<ReturnType<typeof getBackupInfo>>(null)

const exportTask = useAsyncTask({ delay: 200, minVisible: 400, successHold: 300 })
const importTask = useAsyncTask({ delay: 200, minVisible: 400, successHold: 300 })
const exportVisible = exportTask.visible
const importVisible = importTask.visible
const exportStatus = exportTask.status
const importStatus = importTask.status
const exportStage = ref(0)
const importStage = ref(0)
const exportProgress = ref({ done: 0, total: 0 })
const importProgress = ref({ done: 0, total: 0 })
const previewGenerating = ref(false)
let previewToken = 0

const exportOverlayStatus = computed<'loading' | 'success' | 'error'>(() =>
  exportStatus.value === 'success' ? 'success' : exportStatus.value === 'error' ? 'error' : 'loading',
)
const importOverlayStatus = computed<'loading' | 'success' | 'error'>(() =>
  importStatus.value === 'success' ? 'success' : importStatus.value === 'error' ? 'error' : 'loading',
)
const exportErrorText = computed(() => exportError.value || exportTask.error.value || '')
const importErrorText = computed(() => importError.value || importTask.error.value || '')

const exportStages = computed<LoadingStage[]>(() => {
  const { done, total } = exportProgress.value
  return [
    {
      short: '收集',
      full: '收集导出数据…',
      detail: total > 0 ? `已收集 ${done} / ${total} 类` : '读取实体 / 关系 / 字段',
    },
    {
      short: exportFormat.value === 'ws' ? '打包' : '编码',
      full: exportFormat.value === 'ws' ? '打包并下载 .ws…' : '编码并下载…',
      detail: exportFormat.value === 'ws' ? '包含媒体文件' : exportFormat.value === 'yaml' ? 'YAML' : 'JSON',
    },
  ]
})

const importStages = computed<LoadingStage[]>(() => {
  const { done, total } = importProgress.value
  const write: LoadingStage = {
    short: '写入',
    full: '写入导入数据…',
    detail: total > 0 ? `已写入 ${done} / ${total} 类` : '实体 / 关系 / 字段',
  }
  const refresh: LoadingStage = {
    short: '刷新',
    full: '刷新实体 / 关系 / 文件…',
    detail: '重新加载工作区数据',
  }
  if (importStrategy.value === 'overwrite') {
    return [
      { short: '备份', full: '备份当前数据…', detail: '覆盖前自动备份' },
      write,
      refresh,
    ]
  }
  return [write, refresh]
})

const importPack = ref<WorldSeaPack | null>(null)
const importFileName = ref('')
const fileInput = ref<HTMLInputElement>()

// 监听策略切换
watch(importStrategy, (val) => {
  if (val === 'overwrite') {
    overwriteConfirmed.value = false
    backupInfo.value = getBackupInfo()
  } else {
    overwriteConfirmed.value = true
  }
})

/* ─── Serializer 可见列表 ─── */
const availableSerializers = computed(() =>
  serializerRegistry.getSorted().filter(s => s.id !== 'views')
)

// 默认全选（除 views）
const selectedSerializers = ref<string[]>([])

watch(availableSerializers, (list) => {
  selectedSerializers.value = list.map(s => s.id)
}, { immediate: true })

/* ─── 导出预览（异步 computed → watch + ref） ─── */
const exportPreview = ref('')

watch([mode, exportFormat, selectedSerializers], async () => {
  const token = ++previewToken
  if (mode.value !== 'export') {
    exportPreview.value = ''
    previewGenerating.value = false
    return
  }
  if (exportFormat.value === 'ws') {
    exportPreview.value = '（.ws 包为二进制格式，预览不可用。下载后将包含所有数据和媒体文件。）'
    previewGenerating.value = false
    return
  }
  previewGenerating.value = true
  try {
    const ctrl = getExportController(
      { views: pluginStore.views },
    )
    const text = await ctrl.exportToString(exportFormat.value, selectedSerializers.value)
    if (token === previewToken) exportPreview.value = text
  } catch {
    if (token === previewToken) exportPreview.value = '（生成预览失败）'
  } finally {
    if (token === previewToken) previewGenerating.value = false
  }
}, { immediate: true })

/* ─── 导入文件 ─── */
function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) void parseFile(file)
}

function onFileDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) void parseFile(file)
}

async function parseFile(file: File) {
  importError.value = ''
  importPack.value = null
  importReport.value = null
  importFileName.value = file.name
  parsing.value = true
  try {
    const ctrl = getImportController()
    importPack.value = await ctrl.parseImportBlob(file)
  } catch (err: any) {
    importError.value = err.message
  } finally {
    parsing.value = false
  }
}

function clearImport() {
  importPack.value = null
  importFileName.value = ''
  importError.value = ''
  importReport.value = null
}

const importManifest = computed(() => importPack.value?.manifest)

/* ─── 导出操作 ─── */
async function doExport() {
  if (exporting.value) return
  exporting.value = true
  exportError.value = ''
  exportStage.value = 0
  exportProgress.value = { done: 0, total: 0 }
  try {
    await exportTask.run(async () => {
      const ctrl = getExportController(
        { views: pluginStore.views },
      )
      const onProgress = (done: number, total: number) => {
        exportProgress.value = { done, total }
        if (done >= total) exportStage.value = 1
      }
      if (exportFormat.value === 'ws') {
        await ctrl.downloadWS(undefined, selectedSerializers.value, onProgress)
      } else {
        await ctrl.download(exportFormat.value, undefined, selectedSerializers.value, onProgress)
      }
    })
  } catch (err: any) {
    exportError.value = err?.message ?? String(err)
  } finally {
    exporting.value = false
  }
}

function closeExportOverlay(): void {
  exportTask.reset()
}

/* ─── 导入操作 ─── */
async function doImport() {
  const pack = importPack.value
  if (!pack || importing.value) return
  importing.value = true
  importError.value = ''
  importReport.value = null
  importStage.value = 0
  importProgress.value = { done: 0, total: 0 }

  try {
    await importTask.run(async () => {
      const overwrite = importStrategy.value === 'overwrite'
      if (overwrite) {
        importStage.value = 0
        await createBackup()
        importStage.value = 1
      }
      if (overwrite) {
        fieldRegistry.resetToBuiltin()
      }
      const ic = getImportController()
      const report = await ic.importPack(pack, importStrategy.value, (done, total) => {
        importProgress.value = { done, total }
      })
      importReport.value = report
      if (!report.success) {
        const firstError = report.items.flatMap(item => item.errors).find(Boolean)
        throw new Error(firstError ?? '导入失败')
      }
      importStage.value = overwrite ? 2 : 1
      await entityStore.loadAll()
      await relationStore.loadAll()
      fieldRegistry.loadPersisted()
    })
  } catch (err: any) {
    importError.value = err?.message ?? String(err)
  } finally {
    importing.value = false
  }
}

function closeImportOverlay(): void {
  importTask.reset()
}

/* ─── 辅助 ─── */
const backupBusy = ref(false)

async function doBackupFirst() {
  if (backupBusy.value) return
  backupBusy.value = true
  importError.value = ''
  try {
    const ts = await createBackup()
    overwriteConfirmed.value = true
    backupInfo.value = getBackupInfo()
    console.log('[ImportModal] 自动备份完成:', ts)
  } catch (err: any) {
    importError.value = err?.message ?? String(err)
  } finally {
    backupBusy.value = false
  }
}

function serializerIcon(id: string): string {
  const icons: Record<string, string> = {
    'entities': 'item',
    'relations': 'link',
    'entity-types': 'outline',
    'relation-types': 'settings',
    'views': 'image',
    'custom-fields': 'tag',
  }
  return icons[id] ?? 'manuscript'
}

function serializerLabel(id: string): string {
  const s = serializerRegistry.get(id)
  return s?.label ?? id
}

function itemCount(data: unknown): number {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.total === 'number') return d.total
    if (Array.isArray(d.entities)) return d.entities.length
    if (Array.isArray(d.relations)) return d.relations.length
    if (Array.isArray(d.schemas)) return d.schemas.length
    if (Array.isArray(d.views)) return d.views.length
  }
  return 0
}

function close() {
  if (exporting.value || importing.value || parsing.value) return
  exportTask.reset()
  importTask.reset()
  exportError.value = ''
  importError.value = ''
  exportStage.value = 0
  importStage.value = 0
  exportProgress.value = { done: 0, total: 0 }
  importProgress.value = { done: 0, total: 0 }
  mode.value = 'export'
  importPack.value = null
  importReport.value = null
  overwriteConfirmed.value = false
  backupInfo.value = null
  emit('close')
}
</script>

<style scoped>
/* ─── Overlay & Modal ─── */
.ie-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.ie-modal { max-height: 85vh; background: var(--content-bg, #fff); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; position: relative; }
.ie-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border, #eee); }
.ie-header h3 { margin: 0; font-size: var(--font-size-lg); }
.ie-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.ie-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
.ie-tabs { display: flex; gap: 0; margin-bottom: 16px; border-radius: 8px; overflow: hidden; border: 1px solid var(--border, #ddd); }
.ie-tabs button { flex: 1; padding: 8px 16px; border: none; background: var(--bg, var(--color-bg-elevated)); cursor: pointer; font-size: var(--font-size-base); }
.ie-tabs button.active { background: var(--primary, var(--color-primary)); color: #fff; }
.ie-section { display: flex; flex-direction: column; gap: 12px; }
.ie-fmt { display: flex; gap: 16px; }
.ie-fmt label { cursor: pointer; font-size: var(--font-size-base); display: flex; align-items: center; gap: 4px; }

/* ─── Scope (selective export) ─── */
.ie-scope h4, .ie-summary h4, .ie-strategy h4 { font-size: var(--font-size-sm); margin: 0 0 6px; color: var(--text-secondary); }
.ie-scope-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.ie-scope-item {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; border: 1px solid var(--border, #ddd); border-radius: var(--radius-sm);
  font-size: var(--font-size-sm); cursor: pointer; background: var(--bg, #fafafa);
  transition: background 0.12s, border-color 0.12s, color 0.12s, box-shadow 0.12s, transform 0.12s, opacity 0.12s, filter 0.12s;
}
.ie-scope-item:hover { border-color: var(--primary, #4f46e5); background: var(--primary-light, #eef2ff); }
.ie-scope-item.disabled { opacity: 0.4; cursor: not-allowed; }
.ie-scope-item input { margin: 0; }
.scope-icon { font-size: var(--font-size-base); }
.scope-label { font-size: var(--font-size-sm); }
.ie-hint { font-size: var(--font-size-xs); color: var(--text-tertiary); margin: 0; }

/* ─── Preview ─── */
.ie-preview { position: relative; }
.ie-preview textarea { width: 100%; border: 1px solid var(--border, #ddd); border-radius: var(--radius-sm); padding: 8px; font-size: var(--font-size-xs); font-family: monospace; resize: vertical; background: var(--bg, #fafafa); }
.ie-preview-loading {
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

/* ─── Upload ─── */
.ie-upload { border: 2px dashed var(--border-color, var(--color-border)); border-radius: 8px; padding: 20px; text-align: center; cursor: pointer; }
.ie-dropzone { padding: 10px; }
.ie-dropzone--loading { cursor: default; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.dz-icon { font-size: var(--font-size-3xl); display: block; margin-bottom: 6px; }
.ie-dropzone p { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 0; }
.ie-file-info { display: flex; align-items: center; gap: 10px; text-align: left; }
.fi-icon { font-size: var(--font-size-2xl); }
.fi-detail { flex: 1; }
.fi-detail strong { display: block; font-size: var(--font-size-base); }
.fi-meta { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.fi-clear { background: none; border: none; font-size: var(--font-size-lg); cursor: pointer; padding: 2px 6px; }

/* ─── Summary ─── */
.ie-summary-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.is-item { display: flex; align-items: center; gap: 6px; padding: 4px 10px; background: var(--bg, #f3f4f6); border-radius: var(--radius-sm); font-size: var(--font-size-sm); }
.is-count { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.is-icon { font-size: var(--font-size-base); }
.is-label { font-size: var(--font-size-sm); }

/* ─── Strategy ─── */
.ie-strategy label { display: block; font-size: var(--font-size-sm); margin: 4px 0; cursor: pointer; }
.ie-strategy input { margin-right: 6px; }

/* ─── Overwrite Warning ─── */
.ie-overwrite-warn { background: color-mix(in srgb, var(--color-danger, #dc2626) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-danger, #dc2626) 30%, transparent); border-radius: 8px; padding: 12px; }
.ie-warn-text { font-size: var(--font-size-sm); color: var(--color-danger, #dc2626); margin: 0 0 8px; font-weight: var(--font-weight-semibold); }
.ie-warn-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ie-warn-check { font-size: var(--font-size-sm); cursor: pointer; display: flex; align-items: center; gap: 4px; }
.ie-backup-info { font-size: var(--font-size-xs); color: var(--color-success, #16a34a); }
.ie-backup-ok { display: flex; align-items: center; gap: 4px; }
.ie-backup-warn { display: flex; align-items: center; gap: 4px; color: var(--color-danger, #dc2626); font-weight: var(--font-weight-semibold); }

/* ─── Report ─── */
.ie-report { background: var(--bg, #f9fafb); border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 12px; }
.ie-report-status { font-weight: var(--font-weight-semibold); font-size: var(--font-size-base); margin-bottom: 8px; }
.ie-report-status.success { color: var(--success); }
.ie-report-status.fail { color: var(--danger); }
.ir-item { display: flex; gap: 8px; font-size: var(--font-size-sm); padding: 2px 0; }
.ir-label { min-width: 80px; color: var(--text-secondary); }
.ir-stat { color: var(--text-color); }
.ir-err { color: var(--color-danger); font-size: var(--font-size-xs); }

/* ─── Actions ─── */
.ie-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.ie-error { color: var(--color-danger); font-size: var(--font-size-sm); }

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
