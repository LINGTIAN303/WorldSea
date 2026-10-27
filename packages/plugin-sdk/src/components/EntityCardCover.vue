<template>
  <div v-if="hasCover" ref="coverWrap" class="card-cover-wrap">
    <!-- 视频封面（C 批 #15/#16/#17/#18）：首帧静默；三档自动播放；悬停播独立开关 -->
    <video
      v-if="usingVideo"
      ref="videoEl"
      class="card-cover"
      :src="`${entity.videoAsset}#t=0.1`"
      muted
      loop
      playsinline
      preload="metadata"
      :autoplay="autoplayOn"
    ></video>
    <!-- 形象作封面且为模型/Lottie：视口内实时渲染（F3 离屏卸载释放 WebGL/动画资源） -->
    <PortraitRenderer
      v-else-if="portraitLive && inViewport"
      :src="entity.portrait!"
      :kind="entity.portraitKind!"
      class="card-cover-live"
    />
    <div v-else-if="portraitLive" class="card-cover-placeholder"></div>
    <img v-else-if="coverUrl" :src="coverUrl" class="card-cover" :alt="entity.name" :style="coverStyle" />
    <div class="card-cover-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEntityImage } from '@worldsea/entity-core/composables'
import { useSettingsStore, type Entity } from '@worldsea/entity-core'
import PortraitRenderer from './PortraitRenderer.vue'
import { useCardVideoScrollPause } from '../composables/useCardVideoScrollPause'
import { useInViewport } from '../composables/useInViewport'

const props = defineProps<{
  entity: Entity
  coverFieldKey: string
  /** 卡片悬停态（父级 EntityCard 传入；悬停播视频用） */
  hovered?: boolean
}>()

const settings = useSettingsStore()
/** F3：观察封面容器；模型/Lottie 离屏时卸载 PortraitRenderer（占位保高度） */
const coverWrap = ref<HTMLElement | null>(null)
const inViewport = useInViewport(coverWrap)

/** 形象图作封面（coverSource 勾选生效且资产在）：优先级 image < portrait < video（视频源 C 批接入） */
const usingVideo = computed(() => props.entity.coverSource === 'video' && !!props.entity.videoAsset)
const usingPortrait = computed(() => props.entity.coverSource === 'portrait' && !!props.entity.portrait)

/** 模型/Lottie 封面走 PortraitRenderer（img 无能渲染 3D/矢量动画） */
const portraitLive = computed(
  () => usingPortrait.value && (props.entity.portraitKind === 'model' || props.entity.portraitKind === 'lottie'),
)

const coverValue = computed(() => {
  if (usingPortrait.value && !portraitLive.value) return props.entity.portrait
  return props.entity.coverImage || props.entity.properties[props.coverFieldKey]
})

const hasCover = computed(() => {
  if (usingVideo.value || portraitLive.value) return true
  const v = coverValue.value
  if (!v) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'object' && v !== null) {
    const obj = v as Record<string, unknown>
    return Boolean(obj.fileId || obj.url || obj.thumbnail)
  }
  return false
})

const { imageUrl: coverUrl } = useEntityImage(coverValue)

const coverStyle = computed(() => {
  // 形象作封面用形象焦点，否则用封面焦点（语义一致：objectPosition + scale）
  const focus = props.entity.portraitMeta?.focus
  const pos = (usingPortrait.value && focus?.position) || props.entity.coverPosition || '50% 50%'
  const zoom = (usingPortrait.value && focus?.zoom) || props.entity.coverZoom || 1
  return {
    objectPosition: pos,
    transform: `scale(${zoom})`,
    transformOrigin: pos,
  }
})

// ── 视频封面播放策略（C 批）：三档自动播放（off/all/selected）+ 悬停播独立开关 ──
const videoEl = ref<HTMLVideoElement | null>(null)
const { scrolling } = useCardVideoScrollPause()

/** 三档判定（#17：selected=设置中指定的实体列表） */
const autoplayOn = computed(() => {
  if (!usingVideo.value) return false
  const mode = settings.videoCoverAutoplay
  if (mode === 'all') return true
  if (mode === 'selected') return settings.videoCoverAutoplayEntities.includes(props.entity.id)
  return false
})

/** 是否应处于播放态（悬停播 + 自动播放档 + 滚动暂停三者合成） */
const shouldPlay = computed(() => {
  if (scrolling.value && settings.videoCoverPauseOnScroll) return false
  if (autoplayOn.value) return true
  return !!props.hovered && settings.videoCoverHoverPlay
})

watch(shouldPlay, (play) => {
  const v = videoEl.value
  if (!v) return
  if (play) Promise.resolve(v.play()).catch(() => {})
  else {
    v.pause()
    if (!autoplayOn.value) v.currentTime = 0.1 // 非自动档回到首帧
  }
})
</script>

<style scoped>
/* 尺寸约束必须写在组件自身（scoped）：img 在本组件内部，父组件 EntityCard 的 scoped
   样式打不到子组件元素（仅根节点带父 scope）——历史样式因此全部失效，图片按原始尺寸渲染。
   高度 110px 与 EntityCard.vue 既有 .card-cover 设计值一致。 */
.card-cover-wrap {
  position: relative;
  overflow: hidden;
}
.card-cover {
  width: 100%;
  height: 110px;
  object-fit: cover;
  display: block;
}
.card-cover-live {
  height: 110px;
}
.card-cover-placeholder {
  width: 100%;
  height: 110px;
  background: var(--bg-secondary, #f3f4f6);
}
.card-cover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 62%, rgba(0, 0, 0, 0.16));
  pointer-events: none;
}
</style>
