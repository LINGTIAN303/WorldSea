<template>
  <div class="evp">
    <AssetField
      :value="entity.videoAsset"
      kind="video"
      category="video"
      @update:value="onVideo"
    />
    <label class="evp-check" :class="{ disabled: !entity.videoAsset }">
      <input
        type="checkbox"
        :checked="entity.coverSource === 'video'"
        :disabled="!entity.videoAsset"
        @change="onVideoCover"
      />
      <span>视频作为卡片封面</span>
    </label>
    <!-- 上传后即时预览（controls 全功能播放；卡片内播放行为由设置控制） -->
    <video
      v-if="entity.videoAsset"
      class="evp-player"
      :src="entity.videoAsset"
      controls
      playsinline
      preload="metadata"
    ></video>
    <p class="evp-hint">视频可作卡片封面；默认不自动播放（卡片显示首帧），自动播放档位与悬停播放见「设置 → 外观 → 卡片与预览」</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 实体「视频」Tab 面板（2026-10-25 形象图批 C #14/#15）：AssetField(video) 上传落盘
 * assets + 作封面勾选（coverSource 互斥——勾视频即替换形象/封面图源）+ 全功能预览播放。
 * 卡片内播放策略（三档自动播放/悬停播）在 EntityCardCover 读取设置实现，本面板只管资产与勾选。
 */
import AssetField from './AssetField.vue'
import { useEntityStore, type Entity, type CoverSource } from '@worldsea/entity-core'

const props = defineProps<{ entity: Entity }>()
const entityStore = useEntityStore()

function onVideo(val: string | null) {
  if (!val) {
    // 移除视频：正作封面则回退封面图
    const patch: Partial<Entity> = { videoAsset: '' }
    if (props.entity.coverSource === 'video') patch.coverSource = 'image'
    entityStore.update(props.entity.id, patch)
    return
  }
  entityStore.update(props.entity.id, { videoAsset: val })
}

function onVideoCover(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  const next: CoverSource = checked ? 'video' : 'image'
  entityStore.update(props.entity.id, { coverSource: next })
}
</script>

<style scoped>
.evp { display: flex; flex-direction: column; gap: 10px; }
.evp-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
}
.evp-check.disabled { color: var(--text-tertiary); cursor: not-allowed; }
.evp-check input { accent-color: var(--primary); }
.evp-player {
  width: 100%;
  max-height: 320px;
  border-radius: var(--radius-md);
  background: #000;
}
.evp-hint { margin: 0; font-size: var(--font-size-xs, 12px); color: var(--text-tertiary, #9ca3af); }
</style>
