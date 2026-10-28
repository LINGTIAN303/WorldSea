<template>
  <TuiModal
    :show="show"
    :title="pickerTitle"
    size="lg"
    @close="close"
  >
    <div v-if="target" class="ip-body">
      <div class="ip-current">
        <span class="ip-current-icon"><WsIcon :name="target.current" size="md" /></span>
        <span class="ip-current-text">当前：{{ currentLabel }} · {{ iconSourceLabel(target.source) }}</span>
        <span v-if="target.source === 'global'" class="ip-current-hint">继承全局</span>
        <span v-else-if="!currentInCatalog" class="ip-current-hint">{{ isCustomIconValue(target.current) ? '图标文件缺失' : '不在精选库' }}</span>
      </div>

      <input
        v-model="query"
        class="ip-search"
        type="text"
        placeholder="搜索图标（中文名 / 英文名 / 关键词）"
        aria-label="搜索图标"
      />

      <div class="ip-chips" role="tablist" aria-label="图标分类">
        <button
          v-for="category in categories"
          :key="category.id"
          type="button"
          class="ip-chip"
          :class="{ active: activeDomain === category.id }"
          role="tab"
          :aria-selected="activeDomain === category.id"
          @click="activeDomain = category.id"
        >{{ category.label }}</button>
      </div>

      <div v-if="activeDomain === 'custom'" class="ip-custom-tools">
        <input ref="uploadInput" class="ip-file" type="file" accept=".svg,.png,.webp,image/svg+xml,image/png,image/webp" @change="onUploadChange" />
        <button class="ip-upload" type="button" :disabled="!available || uploading" @click="chooseUpload">
          {{ uploading ? '上传中…' : '上传图标' }}
        </button>
        <span class="ip-upload-hint">项目内上传；确定时可勾选「应用到全局」</span>
      </div>

      <div
        ref="gridRef"
        class="ip-grid"
        role="listbox"
        aria-label="图标库"
        @keydown="onGridKeydown"
      >
        <button
          v-for="(entry, index) in filtered"
          :key="entry.name"
          type="button"
          class="ip-tile"
          :class="{ selected: selected === entry.name, active: activeIndex === index }"
          :data-icon-index="index"
          role="option"
          :aria-selected="selected === entry.name"
          :aria-label="entry.label"
          :title="`${entry.label}（${entry.name}）`"
          :tabindex="activeIndex === index ? 0 : -1"
          @click="selectEntry(entry, index)"
          @focus="activeIndex = index"
        >
          <WsIcon :name="entry.name" size="md" />
        </button>
        <div v-if="filtered.length === 0" class="ip-empty">{{ activeDomain === 'custom' ? '还没有自定义图标，点击上方上传' : '没有匹配的图标' }}</div>
      </div>

      <div class="ip-preview" aria-live="polite">
        <span class="ip-preview-label">预览</span>
        <WsIcon :name="selected" size="16" />
        <WsIcon :name="selected" size="20" />
        <WsIcon :name="selected" size="24" />
        <span class="ip-preview-name">{{ selectedLabel }}</span>
      </div>
    </div>

    <template #footer>
      <div class="ip-footer">
        <div class="ip-options">
          <label v-if="target && target.syncCount > 0" class="ip-option">
            <input v-model="syncTypes" type="checkbox" />
            <span>同时更新本芽的 {{ target.syncCount }} 个实体类型图标</span>
            <span v-if="target.syncCount > 1 || !target.syncDefault" class="ip-option-hint">
              只更新仍为默认或仍跟随本芽的图标；已单独设置的不动
            </span>
          </label>
          <label class="ip-option">
            <input v-model="applyGlobal" type="checkbox" />
            <span>应用到全局（其他跟随全局的项目同步）</span>
          </label>
        </div>
        <div class="ip-actions">
          <button
            v-if="target?.canResetProject"
            type="button"
            class="ip-btn ip-btn-ghost"
            @click="onReset"
          >取消本项目设置</button>
          <span class="ip-footer-spacer" />
          <button type="button" class="ip-btn" @click="close">取消</button>
          <button type="button" class="ip-btn ip-btn-primary" :disabled="!selected" @click="confirm">确定</button>
        </div>
      </div>
    </template>
  </TuiModal>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { SPROUT_DOMAINS, customIconId, customIconValue, isCustomIconValue, useIconAssetStore } from '@worldsea/entity-core'
import { isTauri } from '@worldsea/entity-core/core'
import { searchIconCatalog, toastSuccess, toastWarn, WsIcon, type IconCatalogEntry, type IconDomain } from '@worldsea/ui-kit'
import TuiModal from '@/components/ui/TuiModal.vue'
import { iconSlotKindLabel, iconSourceLabel, type IconPickerConfirm, type IconPickerTarget } from '@/world/iconPanelModel'
import { uploadIconFile } from '@/world/iconAssetUpload'

type CategoryId = 'recommended' | 'custom' | 'all' | IconDomain

const props = defineProps<{
  show: boolean
  target: IconPickerTarget | null
}>()

const emit = defineEmits<{
  close: []
  confirm: [payload: IconPickerConfirm]
  reset: []
}>()

const query = ref('')
const activeDomain = ref<CategoryId>('recommended')
const selected = ref('')
const activeIndex = ref(0)
const syncTypes = ref(false)
const applyGlobal = ref(false)
const gridRef = ref<HTMLElement | null>(null)
const iconAssets = useIconAssetStore()
const uploadInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const available = computed(() => isTauri())

const categories = computed<Array<{ id: CategoryId; label: string }>>(() => [
  { id: 'recommended', label: '推荐' },
  { id: 'custom', label: '我的图标' },
  { id: 'all', label: '全部' },
  ...SPROUT_DOMAINS.map(domain => ({ id: domain.id as CategoryId, label: domain.label })),
  { id: 'general', label: '通用' },
])

const customEntries = computed<IconCatalogEntry[]>(() => iconAssets.allAssets.map(({ asset, scope }) => ({
  name: customIconValue(asset.id),
  label: asset.name,
  keywords: `自定义 图标 ${asset.name} ${scope === 'global' ? '全局' : '项目'}`,
  domains: ['general'],
})))

const pickerTitle = computed(() => {
  if (!props.target) return '选择图标'
  return `为${iconSlotKindLabel(props.target.kind)}「${props.target.label}」选择图标`
})

function customAssetOf(value: string) {
  const id = customIconId(value)
  return id ? iconAssets.assetById(id) : null
}

const currentInCatalog = computed(() => {
  const target = props.target
  if (!target) return false
  if (isCustomIconValue(target.current)) return Boolean(customAssetOf(target.current))
  return searchIconCatalog(target.current).some(entry => entry.name === target.current)
})

const currentLabel = computed(() => {
  const target = props.target
  if (!target) return ''
  if (isCustomIconValue(target.current)) return customAssetOf(target.current)?.asset.name ?? target.current
  return searchIconCatalog(target.current).find(entry => entry.name === target.current)?.label ?? target.current
})

const selectedLabel = computed(() => {
  if (isCustomIconValue(selected.value)) return customAssetOf(selected.value)?.asset.name ?? selected.value
  return searchIconCatalog(selected.value).find(entry => entry.name === selected.value)?.label ?? selected.value
})

const filtered = computed<IconCatalogEntry[]>(() => {
  const target = props.target
  if (!target) return []
  if (activeDomain.value === 'custom') {
    const q = query.value.trim().toLowerCase()
    if (!q) return customEntries.value
    return customEntries.value.filter(entry => (
      entry.label.toLowerCase().includes(q) || entry.keywords.toLowerCase().includes(q)
    ))
  }
  if (activeDomain.value === 'all') return searchIconCatalog(query.value)
  if (activeDomain.value === 'recommended') {
    const primary = searchIconCatalog(query.value, target.domain ?? 'general')
    if (!target.domain || target.domain === 'general') return primary
    const general = searchIconCatalog(query.value, 'general')
    const seen = new Set(primary.map(entry => entry.name))
    return [...primary, ...general.filter(entry => !seen.has(entry.name))]
  }
  return searchIconCatalog(query.value, activeDomain.value)
})

watch(() => [props.show, props.target?.key] as const, () => {
  if (!props.show || !props.target) return
  selected.value = props.target.current
  query.value = ''
  activeDomain.value = isCustomIconValue(props.target.current) ? 'custom' : 'recommended'
  activeIndex.value = 0
  syncTypes.value = props.target.syncDefault
  applyGlobal.value = false
  void nextTick(() => {
    const index = filtered.value.findIndex(entry => entry.name === selected.value)
    if (index >= 0) activeIndex.value = index
  })
}, { immediate: true })

watch([query, activeDomain], () => {
  activeIndex.value = 0
})

function selectEntry(entry: IconCatalogEntry, index: number): void {
  selected.value = entry.name
  activeIndex.value = index
}

function onGridKeydown(event: KeyboardEvent): void {
  const count = filtered.value.length
  if (!count) return
  const cols = 8
  let next = activeIndex.value
  if (event.key === 'ArrowRight') next = (next + 1) % count
  else if (event.key === 'ArrowLeft') next = (next - 1 + count) % count
  else if (event.key === 'ArrowDown') next = Math.min(count - 1, next + cols)
  else if (event.key === 'ArrowUp') next = Math.max(0, next - cols)
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = count - 1
  else return
  event.preventDefault()
  activeIndex.value = next
  void nextTick(() => {
    gridRef.value?.querySelector<HTMLButtonElement>(`[data-icon-index="${next}"]`)?.focus()
  })
}

function chooseUpload(): void {
  uploadInput.value?.click()
}

async function onUploadChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const result = await uploadIconFile(file)
    if (!result.ok || !result.asset) {
      toastWarn(result.reason ?? '图标上传失败')
      return
    }
    activeDomain.value = 'custom'
    selected.value = customIconValue(result.asset.id)
    toastSuccess('已上传到本项目')
    await nextTick()
    activeIndex.value = Math.max(0, filtered.value.findIndex(entry => entry.name === selected.value))
  } finally {
    uploading.value = false
  }
}

function close(): void {
  emit('close')
}

function confirm(): void {
  if (!selected.value) return
  emit('confirm', {
    icon: selected.value,
    applyGlobal: applyGlobal.value,
    syncTypes: syncTypes.value,
  })
}

function onReset(): void {
  emit('reset')
}
</script>

<style scoped>
.ip-body { display: flex; flex-direction: column; gap: 10px; }
.ip-current { display: flex; align-items: center; gap: 8px; font-size: var(--font-size-xs, 12px); color: var(--text-secondary); }
.ip-current-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--border); border-radius: var(--radius-sm); }
.ip-current-hint { color: var(--text-tertiary); font-size: var(--text-micro-font-size, 10px); }
.ip-search { width: 100%; box-sizing: border-box; padding: 7px 10px; font-size: var(--font-size-sm); color: var(--text-color, var(--color-text)); background: var(--content-bg, var(--color-bg-surface)); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); outline: none; }
.ip-search:focus { border-color: var(--primary, var(--color-primary)); }
.ip-chips { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.ip-chip { flex-shrink: 0; padding: 4px 8px; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); font-size: var(--font-size-xs, 12px); cursor: pointer; }
.ip-chip:hover { background: var(--hover-bg, var(--color-bg-hover)); color: var(--text-color, var(--color-text)); }
.ip-chip.active { color: var(--primary, var(--color-primary)); border-color: var(--primary, var(--color-primary)); }
.ip-custom-tools { display: flex; align-items: center; gap: 8px; }
.ip-file { display: none; }
.ip-upload { padding: 4px 10px; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--content-bg, var(--color-bg-surface)); color: var(--text-primary, var(--color-text)); font-size: var(--font-size-xs, 12px); cursor: pointer; }
.ip-upload:hover:not(:disabled) { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.ip-upload:disabled { opacity: 0.5; cursor: default; }
.ip-upload-hint { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); }
.ip-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; max-height: 30vh; overflow-y: auto; padding: 2px; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-md); }
.ip-tile { display: inline-flex; align-items: center; justify-content: center; aspect-ratio: 1; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); cursor: pointer; }
.ip-tile:hover { background: var(--hover-bg, var(--color-bg-hover)); color: var(--text-color, var(--color-text)); }
.ip-tile.selected { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.ip-tile:focus-visible { outline: 2px solid var(--primary, var(--color-primary)); outline-offset: -2px; }
.ip-empty { grid-column: 1 / -1; padding: 24px 8px; text-align: center; font-size: var(--font-size-sm); color: var(--text-tertiary); }
.ip-preview { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--bg-secondary, var(--color-bg-elevated)); color: var(--text-secondary); }
.ip-preview-label { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); }
.ip-preview-name { margin-left: auto; font-size: var(--font-size-xs, 12px); color: var(--text-secondary); }
.ip-options { display: flex; flex-direction: column; gap: 6px; }
.ip-option { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: var(--font-size-xs, 12px); color: var(--text-secondary); cursor: pointer; }
.ip-option input { accent-color: var(--primary, var(--color-primary)); }
.ip-option-hint { color: var(--text-tertiary); font-size: var(--text-micro-font-size, 10px); }
.ip-footer { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.ip-actions { display: flex; align-items: center; gap: 8px; width: 100%; }
.ip-footer-spacer { flex: 1; }
.ip-btn { padding: 5px 12px; border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--content-bg, var(--color-bg-surface)); color: var(--text-primary, var(--color-text)); font-size: var(--font-size-xs, 12px); cursor: pointer; }
.ip-btn:hover:not(:disabled) { border-color: var(--primary, var(--color-primary)); color: var(--primary, var(--color-primary)); }
.ip-btn:disabled { opacity: 0.5; cursor: default; }
.ip-btn-ghost { border-color: transparent; color: var(--text-tertiary); }
.ip-btn-primary { background: var(--primary, var(--color-primary)); border-color: var(--primary, var(--color-primary)); color: #fff; }
.ip-btn-primary:hover:not(:disabled) { color: #fff; opacity: 0.9; }
</style>
