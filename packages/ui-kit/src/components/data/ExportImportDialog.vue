<template>
  <div v-if="visible" class="modal-overlay" @click.self="close">
    <div class="modal-content" style="max-width: 480px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="margin:0;font-size:var(--font-size-xl);"><WsIcon name="item" size="xs" /> {{ mode === 'export' ? '导出数据' : '导入数据' }}</h2>
        <button class="dlg-close" @click="close">✕</button>
      </div>

      <!-- 导出 -->
      <div v-if="mode === 'export'">
        <p style="font-size:var(--font-size-sm);color:var(--text-secondary);margin-bottom:12px;">
          将所有实体和关系数据导出为 JSON 文件，可用于备份或迁移。
        </p>
        <div class="export-stats" style="font-size:var(--font-size-sm);color:var(--text-secondary);margin-bottom:16px;">
          <div>实体：{{ entityCount }} 条</div>
          <div>关系：{{ relationCount }} 条</div>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="close">取消</button>
          <button class="btn-primary" @click="doExport" :disabled="exporting">
            <template v-if="!exporting"><WsIcon name="item" size="xs" /> 导出为 JSON</template>
            <template v-else>导出中...</template>
          </button>
        </div>
      </div>

      <!-- 导入 -->
      <div v-else>
        <p style="font-size:var(--font-size-sm);color:var(--text-secondary);margin-bottom:12px;">
          选择一个之前导出的 JSON 文件恢复数据。
          <strong style="color:var(--warning);">导入会覆盖当前数据，请谨慎操作。</strong>
        </p>
        <div class="import-zone" @dragover.prevent @drop.prevent="onFileDrop">
          <input ref="fileInput" type="file" accept=".json" style="display:none" @change="onFileChange" />
          <div v-if="!preview" class="import-placeholder" @click="fileInput?.click()">
            <span style="font-size:var(--icon-xl);"><WsIcon name="folder" size="xl" /></span>
            <p>点击选择文件，或拖拽 JSON 文件到此处</p>
          </div>
          <div v-else class="import-preview">
            <div style="font-size:var(--font-size-sm);margin-bottom:8px;">
              <strong>{{ preview.name }}</strong>
              <span style="color:var(--text-tertiary);margin-left:8px;">{{ (preview.size / 1024).toFixed(1) }} KB</span>
            </div>
            <div style="font-size:var(--font-size-sm);color:var(--text-secondary);">
              实体：{{ preview.entities }} 条 · 关系：{{ preview.relations }} 条
            </div>
            <div v-if="importError" style="color:var(--danger);font-size:var(--font-size-sm);margin-top:8px;">
              <WsIcon name="warning" size="xs" /> {{ importError }}
            </div>
          </div>
        </div>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn-secondary" @click="close">取消</button>
          <button class="btn-danger" @click="doImport" :disabled="!preview || importing">
            <template v-if="!importing"><WsIcon name="item" size="xs" /> 导入数据</template>
            <template v-else>导入中...</template>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import WsIcon from '../WsIcon.vue'
import { useEntityStore, useRelationStore, storage } from '@worldsmith/entity-core'

const props = defineProps<{ mode: 'export' | 'import' }>()
const visible = ref(false)
const entityStore = useEntityStore()
const relationStore = useRelationStore()

const exporting = ref(false)
const importing = ref(false)
const fileInput = ref<HTMLInputElement>()
const preview = ref<{ name: string; size: number; entities: number; relations: number } | null>(null)
const importData = ref<any>(null)
const importError = ref('')

const entityCount = computed(() => entityStore.entities.length)
const relationCount = computed(() => relationStore.relations.length)

/* ─── 导出 ─── */

async function doExport() {
  exporting.value = true
  try {
    const entities = await storage.getAllEntities()
    const relations = await storage.getAllRelations()
    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      entities,
      relations,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `worldsmith-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    alert('导出失败：' + (e as Error).message)
  } finally {
    exporting.value = false
    close()
  }
}

/* ─── 导入 ─── */

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) parseFile(file)
}

function onFileDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file) parseFile(file)
}

function parseFile(file: File) {
  importError.value = ''
  preview.value = null
  importData.value = null

  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result as string)
      if (!data.entities || !data.relations) {
        importError.value = '无效的备份文件：缺少 entities 或 relations 字段'
        return
      }
      preview.value = {
        name: file.name,
        size: file.size,
        entities: data.entities.length,
        relations: data.relations.length,
      }
      importData.value = data
    } catch {
      importError.value = '无效的 JSON 文件'
    }
  }
  reader.readAsText(file)
}

async function doImport() {
  if (!importData.value) return
  importing.value = true
  try {
    // 清空现有数据
    await storage.clearEntities()
    await storage.clearRelations()

    await storage.importEntities(importData.value.entities)
    await storage.importRelations(importData.value.relations)

    // 刷新 store
    await entityStore.loadAll()
    await relationStore.loadAll()

    close()
    alert(`导入完成：${importData.value.entities.length} 条实体，${importData.value.relations.length} 条关系`)
  } catch (e) {
    alert('导入失败：' + (e as Error).message)
  } finally {
    importing.value = false
  }
}

function open() {
  visible.value = true
  preview.value = null
  importData.value = null
  importError.value = ''
}

function close() {
  visible.value = false
}

defineExpose({ open })
</script>

<style scoped>
.dlg-close { width: 28px; height: 28px; border: none; background: transparent; border-radius: 6px; cursor: pointer; font-size: var(--font-size-lg); color: var(--text-tertiary); display: flex; align-items: center; justify-content: center; }
.dlg-close:hover { background: var(--color-bg-hover); }

.import-zone { border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 24px; text-align: center; cursor: pointer; transition: border-color var(--transition-fast); }
.import-zone:hover { border-color: var(--primary); }
.import-placeholder p { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 8px 0 0; }
.import-preview { text-align: left; }

.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn-primary { padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-size: var(--font-size-base); }
.btn-secondary { padding: 8px 16px; background: var(--color-bg-elevated); color: var(--text-color); border: none; border-radius: var(--radius-md); cursor: pointer; font-size: var(--font-size-base); }
.btn-danger { padding: 8px 16px; background: var(--danger); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-size: var(--font-size-base); }
.btn-primary:disabled, .btn-danger:disabled { opacity: 0.5; cursor: default; }
</style>