<template>
  <div class="set-card deck-card ic-card" v-show="matchKeywords(searchQuery, keywords)">
    <div class="sc-head">
      <span>自定义图标</span>
      <span class="ic-sub">项目内上传 · 可选同步全局 · 单色跟随主题</span>
    </div>

    <div class="ia-upload-row">
      <input ref="fileInput" class="ia-file" type="file" accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp" @change="onFileChange" />
      <button class="set-btn" type="button" :disabled="!available || uploading" @click="chooseFile">
        {{ uploading ? '上传中…' : '上传图标' }}
      </button>
      <label class="ia-global"><input v-model="alsoGlobal" type="checkbox" :disabled="!available" />同时保存到全局</label>
      <span v-if="!available" class="ia-hint">当前环境不支持文件写入</span>
    </div>

    <div v-if="assets.length === 0" class="ia-empty">还没有自定义图标。支持 SVG / PNG / WebP（建议透明背景），SVG ≤ 256KB，位图 ≤ 512KB。</div>
    <div v-else class="ia-list">
      <div v-for="item in assets" :key="`${item.scope}:${item.asset.id}`" class="ia-row">
        <span class="ia-icon"><WsIcon :name="customIconValue(item.asset.id)" size="md" /></span>
        <span class="ia-name" :title="item.asset.name">{{ item.asset.name }}</span>
        <span class="ia-scope" :class="`is-${item.scope}`">{{ item.scope === 'global' ? '全局' : '项目' }}</span>
        <span class="ia-size">{{ formatIconBytes(item.asset.bytes) }}</span>
        <span v-if="iconStore.currentUsageCount(item.asset.id) > 0" class="ia-used">使用 {{ iconStore.currentUsageCount(item.asset.id) }}</span>
        <button class="ia-delete" type="button" :disabled="checkingId === item.asset.id" @click="remove(item)">删除</button>
      </div>
    </div>
    <div class="set-hint">删除前会检查所有项目的图标引用；仍被使用时不会删除。</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { isTauri } from '@worldsea/entity-core/core'
import {
  customIconValue,
  formatIconBytes,
  useIconAssetStore,
  type ScopedIconAsset,
} from '@worldsea/entity-core'
import { matchKeywords, toastSuccess, toastWarn, useConfirm, WsIcon } from '@worldsea/ui-kit'
import { uploadIconFile } from '@/world/iconAssetUpload'

const props = withDefaults(defineProps<{ searchQuery?: string }>(), { searchQuery: '' })

const keywords = '自定义图标 上传 图标库 项目 全局 icon upload custom'
const iconStore = useIconAssetStore()
const { confirm } = useConfirm()
const fileInput = ref<HTMLInputElement | null>(null)
const alsoGlobal = ref(false)
const uploading = ref(false)
const checkingId = ref('')
const available = computed(() => isTauri())

const assets = computed<ScopedIconAsset[]>(() => iconStore.allAssets)

function chooseFile(): void {
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const result = await uploadIconFile(file, { alsoGlobal: alsoGlobal.value })
    if (!result.ok || !result.asset) {
      toastWarn(result.reason ?? '图标上传失败')
      return
    }
    toastSuccess(result.globalAsset ? '已上传到本项目与全局' : '已上传到本项目')
  } finally {
    uploading.value = false
  }
}

function slotLabel(key: string): string {
  const [kind, ...rest] = key.split(':')
  const label = { sprout: '芽', entityType: '实体类型', domain: '语义域', detailTab: '详情页签', regionType: '区域类型' }[kind] ?? kind
  return `${label} ${rest.join(':')}`
}

function usageText(usage: Array<{ projectName: string; slots: string[] }>): string {
  return usage
    .map(item => `${item.projectName}：${item.slots.map(slotLabel).join('、')}`)
    .join('\n')
}

async function remove(item: ScopedIconAsset): Promise<void> {
  checkingId.value = item.asset.id
  try {
    const usage = await iconStore.usageOf(item.asset.id)
    if (usage.length) {
      await confirm({
        type: 'warning',
        title: '图标仍在使用',
        description: `请先换掉这些引用，再删除「${item.asset.name}」：\n${usageText(usage)}`,
        confirmText: '知道了',
      })
      return
    }
    const ok = await confirm({
      type: 'danger',
      title: '删除自定义图标？',
      description: `「${item.asset.name}」将从${item.scope === 'global' ? '全局' : '本项目'}删除。`,
      confirmText: '删除',
    })
    if (!ok) return
    if (item.scope === 'global') await iconStore.deleteGlobalAsset(item.asset.id)
    else await iconStore.deleteProjectAsset(item.asset.id)
    toastSuccess('已删除图标')
  } finally {
    checkingId.value = ''
  }
}
</script>

<style scoped>
.ic-card { gap: 8px; }
.ic-sub { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); text-transform: none; letter-spacing: normal; font-weight: var(--font-weight-normal, 400); }
.ia-upload-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.ia-file { display: none; }
.ia-global { display: inline-flex; align-items: center; gap: 4px; font-size: var(--font-size-xs, 12px); color: var(--text-secondary); cursor: pointer; }
.ia-global input { accent-color: var(--primary, var(--color-primary)); }
.ia-hint { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); }
.ia-empty { padding: 20px 8px; text-align: center; font-size: var(--font-size-sm); color: var(--text-tertiary); }
.ia-list { display: flex; flex-direction: column; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-md); overflow: hidden; }
.ia-row { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px; border-top: 1px solid var(--border, var(--color-border)); }
.ia-row:first-child { border-top: none; }
.ia-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); color: var(--text-secondary); }
.ia-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-size-sm); }
.ia-scope { flex-shrink: 0; padding: 1px 5px; border-radius: 999px; font-size: var(--text-micro-font-size, 10px); background: var(--bg-secondary, var(--color-bg-elevated)); color: var(--text-tertiary); }
.ia-scope.is-project { color: var(--success, var(--color-success)); }
.ia-scope.is-global { color: var(--primary, var(--color-primary)); }
.ia-size { flex-shrink: 0; font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); }
.ia-used { flex-shrink: 0; font-size: var(--text-micro-font-size, 10px); color: var(--warning, var(--color-warning)); }
.ia-delete { margin-left: auto; flex-shrink: 0; padding: 0 4px; border: none; background: transparent; color: var(--text-tertiary); font-size: var(--text-micro-font-size, 10px); cursor: pointer; }
.ia-delete:hover { color: var(--danger, var(--color-danger)); }
.ia-delete:disabled { opacity: 0.5; cursor: default; }
</style>
