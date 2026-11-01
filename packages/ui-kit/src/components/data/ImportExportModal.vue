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
            <div v-if="parsing" class="ie-dropzone ie-dropzone--loading">
              <WsInlineLoading size="lg" label="正在解析导入文件" />
              <p>正在解析文件…</p>
            </div>
            <div v-else-if="!importPack" class="ie-dropzone" @click="onPickFile">
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
  pickLocalFiles,
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
// 加载阶段文案 / 序列化器映射 / 条目计数（纯函数，见 importExportView.ts）
import { buildExportStages, buildImportStages, itemCount, serializerIcon, serializerLabel } from './importExportView'

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
  if (!props.show || e.key !== 'Tab') return
  const box = boxRef.value
  if (!box) return
  const focusables = box.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  const outside = !box.contains(active)
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault()
    first.focus()
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

// AsyncTaskStatus（idle/empty 等）非三态的都按 loading 呈现
const overlayStatus = (s: { value: 'success' | 'error' | 'idle' | 'empty' | 'loading' }) =>
  (s.value === 'success' ? 'success' : s.value === 'error' ? 'error' : 'loading') as 'loading' | 'success' | 'error'
const exportOverlayStatus = computed(() => overlayStatus(exportStatus))
const importOverlayStatus = computed(() => overlayStatus(importStatus))
const exportErrorText = computed(() => exportError.value || exportTask.error.value || '')
const importErrorText = computed(() => importError.value || importTask.error.value || '')

const exportStages = computed<LoadingStage[]>(() => buildExportStages(exportFormat.value, exportProgress.value))

const importStages = computed<LoadingStage[]>(() => buildImportStages(importStrategy.value, importProgress.value))

const importPack = ref<WorldSeaPack | null>(null)
const importFileName = ref('')

// 监听策略切换
watch(importStrategy, (val) => {
  overwriteConfirmed.value = val !== 'overwrite'
  if (val === 'overwrite') backupInfo.value = getBackupInfo()
})

/* ─── Serializer 可见列表 ─── */
const availableSerializers = computed(() => serializerRegistry.getSorted().filter(s => s.id !== 'views'))

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

/* ─── 导入文件（自绘选择器；拖拽/粘贴仍走 onFileDrop） ─── */
async function onPickFile() {
  const r = await pickLocalFiles({
    multiple: false,
    title: '选择导入文件',
    filters: [{ name: 'WorldSea 数据包 / JSON / YAML', extensions: ['json', 'yaml', 'yml', 'ws'] }],
  })
  if (r.items[0]) await parseFile(r.items[0])
  else if (r.reasons.length) importError.value = r.reasons[0]
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
    importPack.value = await getImportController().parseImportBlob(file)
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
      if (exportFormat.value === 'ws') await ctrl.downloadWS(undefined, selectedSerializers.value, onProgress)
      else await ctrl.download(exportFormat.value, undefined, selectedSerializers.value, onProgress)
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

<style scoped src="./import-export-modal.css"></style>
