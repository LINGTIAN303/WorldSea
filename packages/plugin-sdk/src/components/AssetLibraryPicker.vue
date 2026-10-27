<template>
  <Teleport to="body">
    <div class="alp-overlay" @click.self="$emit('close')">
      <div class="alp-dialog" role="dialog" aria-modal="true" aria-label="从资产库选择">
        <header class="alp-bar">
          <span class="alp-title">从资产库选择</span>
          <button class="alp-close" aria-label="关闭资产库" @click="$emit('close')">×</button>
        </header>
        <div class="alp-body">
          <p v-if="loading" class="alp-state">
            正在读取资产库…
          </p>
          <p v-else-if="!assets.length" class="alp-state">
            资产库为空——先上传一个{{ categoryKindLabel }}，之后可跨实体复用。
          </p>
          <ul v-else class="alp-grid">
            <li v-for="a in assets" :key="a.path">
              <button class="alp-item" @click="$emit('select', a)">
                <img v-if="hasThumb(a.kind)" :src="assetUrl(a.path)" class="alp-thumb" alt="" />
                <span v-else class="alp-icon">
                  <WsIcon :name="iconFor(a.kind)" size="lg" />
                </span>
                <span class="alp-info">
                  <span class="alp-name" :title="a.name">{{ a.name }}</span>
                  <span class="alp-meta">{{ ASSET_KIND_LABELS[a.kind] }} · {{ sizeText(a.size) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 资产库选择器（F1 资产库复用）：列出 `{entityDataDir}/assets/` 中已有资产，供跨实体复用。
 * 类别判定与过滤在 entity-core（listProjectAssets 纯函数），本组件只负责呈现与选择；
 * 选中后由 AssetField 转换 URL 并回写 kind（png/webp 动图再经 refineKind 修正）。
 */
import { computed, onMounted, ref } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { listProjectAssets, ASSET_KIND_LABELS, type AssetKind, type ProjectAssetInfo } from '@worldsea/entity-core/core'
import { WsIcon } from '@worldsea/ui-kit'

const props = withDefaults(defineProps<{ kinds: AssetKind[]; category?: 'portrait' | 'video' }>(), {
  category: 'portrait',
})

defineEmits<{
  select: [asset: ProjectAssetInfo]
  close: []
}>()

const loading = ref(true)
const assets = ref<ProjectAssetInfo[]>([])

const categoryKindLabel = computed(() =>
  props.category === 'video' ? '视频' : '形象图（静态/动图/Lottie/模型）',
)

function hasThumb(kind: AssetKind): boolean {
  return kind === 'static' || kind === 'animated'
}

function iconFor(kind: AssetKind): string {
  if (kind === 'video') return 'video'
  if (kind === 'model') return 'package'
  if (kind === 'lottie') return 'zap'
  return 'image'
}

function assetUrl(path: string): string {
  return convertFileSrc(path.replace(/\\/g, '/'))
}

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

onMounted(async () => {
  assets.value = await listProjectAssets(props.kinds)
  loading.value = false
})
</script>

<style scoped>
.alp-overlay {
  position: fixed;
  inset: 0;
  z-index: 2300;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.alp-dialog {
  width: min(680px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--surface-color, var(--bg-color));
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.alp-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
}
.alp-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-color);
}
.alp-close {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}
.alp-close:hover {
  color: var(--text-color);
  background: var(--hover-bg, rgba(127, 127, 127, 0.12));
}
.alp-body {
  padding: 12px;
  overflow-y: auto;
}
.alp-state {
  margin: 24px 8px;
  text-align: center;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
.alp-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}
.alp-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--card-bg, transparent);
  cursor: pointer;
  text-align: left;
  color: var(--text-color);
}
.alp-item:hover {
  border-color: var(--primary);
  background: var(--primary-light);
}
.alp-thumb,
.alp-icon {
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  object-fit: contain;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    conic-gradient(var(--border-color, #d1d5db) 0 25%, transparent 0 50%) 0 0 / 12px 12px,
    conic-gradient(var(--border-color, #d1d5db) 0 25%, transparent 0 50%) 6px 6px / 12px 12px;
  color: var(--text-secondary);
}
.alp-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.alp-name {
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alp-meta {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}
</style>
