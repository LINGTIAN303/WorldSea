<template>
  <div class="asset-field">
    <!-- 导入中：进度反馈（批 C 走查——大视频静默导入无反馈曾被误判失败） -->
    <div v-if="importing" class="asset-importing" role="status">
      <div class="asset-progress-track">
        <div class="asset-progress-bar" :style="{ width: progressPct }"></div>
      </div>
      <p class="asset-progress-text">
        {{ progressText }}
      </p>
    </div>
    <div
      v-else-if="!value"
      class="asset-empty"
    >
      <div
        class="asset-drop-zone"
        :class="{ 'drop-active': isDragging }"
        role="button"
        tabindex="0"
        :aria-label="`选择或拖拽${categoryLabel}`"
        @click="pickByDialog"
        @keydown.enter.prevent="pickByDialog"
        @keydown.space.prevent="pickByDialog"
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="onDrop"
      >
        <WsIcon :name="categoryIcon" size="lg" />
        <p>拖拽{{ categoryLabel }}到此处</p>
        <p>或点击选择文件（支持大文件）</p>
      </div>
      <TuiButton class="asset-library-btn" variant="secondary" size="sm" @click="openLibrary">从资产库选</TuiButton>
    </div>
    <template v-else>
      <div class="asset-preview" :class="`kind-${kind || 'static'}`">
        <!-- 透明底纹：形象图常为透明底，格子底显式呈现透明区（video 不铺） -->
        <img v-if="kind === 'static' || kind === 'animated'" :src="value" class="asset-img" alt="资产预览" />
        <!-- lottie/model：PortraitRenderer 实时渲染（B 批起接管，替代「已就绪」占位） -->
        <PortraitRenderer v-else-if="liveKind" ref="liveRef" :src="value" :kind="liveKind" class="asset-live-preview" />
      </div>
      <div class="asset-field-actions">
        <TuiButton class="asset-library-btn" variant="secondary" size="sm" @click="openLibrary">从资产库选</TuiButton>
        <TuiButton variant="secondary" size="sm" @click="pickByDialog">重新选择</TuiButton>
        <TuiButton variant="danger-ghost" size="sm" @click="removeAsset">移除</TuiButton>
        <label v-if="category === 'portrait'" class="asset-kind-select">
          <span>类别</span>
          <select :value="kind" @change="onKindChange">
            <option v-for="k in portraitKinds" :key="k" :value="k">{{ ASSET_KIND_LABELS[k] }}</option>
          </select>
        </label>
      </div>
    </template>
    <AssetLibraryPicker
      v-if="libraryOpen"
      :kinds="libraryKinds"
      :category="category"
      @select="onLibrarySelect"
      @close="libraryOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 通用资产上传字段（2026-10-25 形象图批计划 A 批）。与 ImageField（IDB base64 链路）分流：
 * 本组件走磁盘 assets 链路（entity-core/assetImport）——对话框路径直传为主（大文件不经
 * base64 IPC），拖拽/粘贴 File 为兜底（≤30MB）。视频类别供 C 批视频 Tab 复用。
 * 上传时按扩展名自动判定 kind，误判（APNG/动图 WebP 扩展名与静态同）可下拉改判。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  importAssetByDialog,
  importAssetByFile,
  detectAssetKind,
  isAnimatedAsset,
  ASSET_KIND_LABELS,
  type AssetKind,
  type ProjectAssetInfo,
} from '@worldsea/entity-core/core'
import { getToastApi } from '@worldsea/entity-core/core'
import { TuiButton, WsIcon } from '@worldsea/ui-kit'
import PortraitRenderer from './PortraitRenderer.vue'
import AssetLibraryPicker from './AssetLibraryPicker.vue'

const props = withDefaults(
  defineProps<{
    /** 资产 URL（convertFileSrc 产物）；空 = 未设置 */
    value?: string | null
    kind?: AssetKind | null
    /** 用途：形象（四类可选）或视频（C 批） */
    category?: 'portrait' | 'video'
  }>(),
  { value: '', kind: null, category: 'portrait' },
)

const emit = defineEmits<{
  'update:value': [src: string | null]
  'update:kind': [kind: AssetKind | null]
}>()

const isDragging = ref(false)
/** 导入反馈（批 C 走查）：importing 期间显示进度；直传链路有真实百分比，File 链路为不定态 */
const importing = ref(false)
const progress = ref<{ copied: number; total: number } | null>(null)
/** 形象用途下可改判的类别集合（video 用途只有 video 一种） */
const portraitKinds: AssetKind[] = ['static', 'animated', 'lottie', 'model']

const progressPct = computed(() => {
  if (!progress.value || !progress.value.total) return '30%'
  return `${Math.min(100, Math.round((progress.value.copied / progress.value.total) * 100))}%`
})
const progressText = computed(() => {
  if (!progress.value || !progress.value.total) return '正在导入…'
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`
  return `正在导入 ${mb(progress.value.copied)} / ${mb(progress.value.total)}`
})

const categoryLabel = computed(() => ASSET_KIND_LABELS[props.category === 'video' ? 'video' : (props.kind ?? 'static')])
const kind = computed(() => props.category === 'video' ? 'video' : props.kind)
/** lottie/model 子集（PortraitRenderer 的 kind 参数类型；video 不属形象渲染） */
const liveKind = computed(() => (kind.value === 'lottie' || kind.value === 'model') ? kind.value : null)
const categoryIcon = computed(() =>
  props.category === 'video' ? 'video' : kind.value === 'model' ? 'package' : kind.value === 'lottie' ? 'zap' : 'image',
)

function toastError(reason: string) {
  getToastApi().error(reason)
}

/** 判 static 资产是否实为动图（APNG/动图 WebP，扩展名不可辨）；是则修正 kind */
async function refineKind(kind: AssetKind, assetUrl: string): Promise<AssetKind> {
  if (kind !== 'static') return kind
  const ext = assetUrl.split('.').pop()?.toLowerCase() ?? ''
  if (ext !== 'png' && ext !== 'webp') return kind
  return (await isAnimatedAsset(assetUrl)) ? 'animated' : kind
}

// ── 资产库复用（F1）：列同类全部资产（形象=四类并集），选中自动判定类别 ──
const libraryOpen = ref(false)
const libraryKinds = computed<AssetKind[]>(() =>
  props.category === 'video' ? ['video'] : ['static', 'animated', 'lottie', 'model'],
)

function openLibrary() {
  if (importing.value) return
  libraryOpen.value = true
}

/** 选中库内资产：路径 → asset URL；kind 以库内判定为准（png/webp 动图再修正） */
async function onLibrarySelect(asset: ProjectAssetInfo): Promise<void> {
  libraryOpen.value = false
  const src = convertFileSrc(asset.path.replace(/\\/g, '/'))
  emit('update:value', src)
  emit('update:kind', await refineKind(asset.kind, src))
}

/** 对话框路径直传（主链路，支持大文件）；选择结果含 kind 判定，一并 emit */
async function pickByDialog(): Promise<void> {
  if (importing.value) return
  const target = props.category === 'video' ? 'video' : (props.kind ?? 'static')
  importing.value = true
  progress.value = null
  const res = await importAssetByDialog(target, (copied, total) => {
    progress.value = { copied, total }
  })
  importing.value = false
  progress.value = null
  if (!res.ok) {
    if (res.reason) toastError(res.reason)
    return
  }
  emit('update:value', res.src ?? null)
  emit('update:kind', await refineKind(target, res.src ?? ''))
}

/** 拖拽/粘贴 File 兜底链路：自动判类（与当前类别不符直接拒，防拖错文件） */
async function importFile(file: File): Promise<void> {
  if (importing.value) return
  const detected = detectAssetKind(file.name)
  if (!detected || (props.category === 'portrait' && detected === 'video') || (props.category === 'video' && detected !== 'video')) {
    toastError(`「${file.name}」不是可接受的${ASSET_KIND_LABELS[props.category === 'video' ? 'video' : (props.kind ?? 'static')]}格式`)
    return
  }
  importing.value = true
  progress.value = null
  const res = await importAssetByFile(detected, file)
  importing.value = false
  progress.value = null
  if (!res.ok) {
    toastError(res.reason ?? '导入失败')
    return
  }
  emit('update:value', res.src ?? null)
  emit('update:kind', await refineKind(detected, res.src ?? ''))
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files[0]
  if (file) void importFile(file)
}

function onDocumentPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) void importFile(file)
      break
    }
  }
}

function onKindChange(e: Event) {
  emit('update:kind', (e.target as HTMLSelectElement).value as AssetKind)
}

function removeAsset() {
  emit('update:value', null)
  emit('update:kind', null)
}

/** 模型动作清单透传（D2 配置 UI 枚举用；经内部 PortraitRenderer 的 load 事件填充） */
const liveRef = ref<InstanceType<typeof PortraitRenderer> | null>(null)
const availableAnimations = computed(() => liveRef.value?.availableAnimations ?? [])
defineExpose({ availableAnimations })

onMounted(() => document.addEventListener('paste', onDocumentPaste))
onUnmounted(() => document.removeEventListener('paste', onDocumentPaste))
</script>

<style scoped>
.asset-drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 100px;
  padding: 20px;
  border: 2px dashed var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: border-color var(--transition), background var(--transition);
}
.asset-importing {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 12px;
}
.asset-progress-track {
  height: 6px;
  border-radius: 3px;
  background: var(--border-color);
  overflow: hidden;
}
.asset-progress-bar {
  height: 100%;
  border-radius: 3px;
  background: var(--primary);
  transition: width 0.2s ease;
}
.asset-progress-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  text-align: center;
}
.asset-drop-zone.drop-active {
  border-color: var(--primary);
  background: var(--primary-light);
}
.asset-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.asset-preview {
  border-radius: var(--radius-md);
  overflow: hidden;
}
/* 透明底纹（conic-gradient 格子）：仅 2D 形象铺，让透明区可见 */
.asset-preview.kind-static,
.asset-preview.kind-animated {
  background:
    conic-gradient(var(--border-color, #d1d5db) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
    conic-gradient(var(--border-color, #d1d5db) 0 25%, transparent 0 50%) 8px 8px / 16px 16px;
}
.asset-img {
  display: block;
  width: 100%;
  max-height: 200px;
  object-fit: contain;
}
.asset-live-preview {
  height: 200px;
}
.asset-field-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.asset-kind-select {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}
.asset-kind-select select {
  padding: 3px 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  background: var(--input-bg);
  color: var(--text-color);
}
</style>
