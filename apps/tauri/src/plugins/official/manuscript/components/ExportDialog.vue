<template>
  <div class="export-overlay" @click.self="$emit('close')">
    <div class="export-dialog">
      <h3><WsIcon name="item" size="sm" /> 导出</h3>

      <div class="export-section">
        <label class="export-label">格式</label>
        <div class="export-formats">
          <button v-for="f in formats" :key="f.value" class="export-fmt-btn" :class="{ active: selectedFormat === f.value }" @click="selectedFormat = f.value">
            <WsIcon :name="f.icon" size="xs" /> {{ f.label }}
          </button>
        </div>
      </div>

      <div class="export-section">
        <label class="export-label">范围</label>
        <div class="export-formats">
          <button class="export-fmt-btn" :class="{ active: scope === 'current' }" @click="scope = 'current'">当前章节</button>
          <button class="export-fmt-btn" :class="{ active: scope === 'all' }" @click="scope = 'all'">全部章节</button>
        </div>
      </div>

      <div v-if="selectedFormat === 'txt'" class="export-section">
        <label class="export-check">
          <input type="checkbox" v-model="includeTitle" />
          包含章节标题
        </label>
      </div>

      <div v-if="selectedFormat === 'md'" class="export-section">
        <label class="export-check">
          <input type="checkbox" v-model="includeFrontmatter" />
          包含元数据 frontmatter
        </label>
      </div>

      <div class="export-actions">
        <button class="btn-secondary" @click="$emit('close')">取消</button>
        <button class="btn-primary" @click="doExport" :disabled="exporting">
          {{ exporting ? '导出中...' : '导出' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useManuscriptExport } from '../composables/useManuscriptExport'
import type { Entity } from '@worldsmith/entity-core'

const props = defineProps<{
  currentChapter: Entity | null
  allChapters: Entity[]
}>()

defineEmits<{ close: [] }>()

const { exportChapter, exportMultiple } = useManuscriptExport()

const formats = [
  { value: 'txt' as const, label: 'TXT', icon: 'manuscript' },
  { value: 'md' as const, label: 'Markdown', icon: 'edit' },
  { value: 'docx' as const, label: 'DOCX', icon: 'manuscript' },
]

const selectedFormat = ref<'txt' | 'md' | 'docx'>('txt')
const scope = ref<'current' | 'all'>('current')
const includeTitle = ref(true)
const includeFrontmatter = ref(true)
const exporting = ref(false)

async function doExport() {
  exporting.value = true
  try {
    if (scope.value === 'current' && props.currentChapter) {
      await exportChapter(props.currentChapter, selectedFormat.value, {
        includeTitle: includeTitle.value,
        includeFrontmatter: includeFrontmatter.value,
      })
    } else if (scope.value === 'all' && props.allChapters.length > 0) {
      await exportMultiple(props.allChapters, selectedFormat.value, {
        includeTitle: includeTitle.value,
        includeFrontmatter: includeFrontmatter.value,
      })
    }
  } catch (err) {
    console.error('Export failed:', err)
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.export-overlay {
  position: fixed; inset: 0; background: var(--color-overlay);
  display: flex; align-items: center; justify-content: center; z-index: 300;
}
.export-dialog {
  background: var(--modal-bg); border-radius: var(--radius-2xl); padding: 20px;
  max-width: 400px; width: 90%;
}
.export-dialog h3 { margin: 0 0 16px; font-size: var(--font-size-lg); }
.export-section { margin-bottom: 14px; }
.export-label { display: block; font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); margin-bottom: 6px; color: var(--text-secondary); }
.export-formats { display: flex; gap: 6px; }
.export-fmt-btn {
  padding: 6px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  background: var(--input-bg); color: var(--text-color); font-size: var(--font-size-sm);
  cursor: pointer; transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s;
}
.export-fmt-btn:hover { border-color: var(--primary); }
.export-fmt-btn.active { background: var(--primary-light); border-color: var(--primary); color: var(--primary); }
.export-check {
  display: flex; align-items: center; gap: 6px; font-size: var(--font-size-sm); cursor: pointer;
}
.export-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
