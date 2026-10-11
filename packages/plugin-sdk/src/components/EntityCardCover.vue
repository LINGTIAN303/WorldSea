<template>
  <div v-if="hasCover" class="card-cover-wrap">
    <img v-if="coverUrl" :src="coverUrl" class="card-cover" :alt="entity.name" :style="coverStyle" />
    <div class="card-cover-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEntityImage } from '@worldsea/entity-core/composables'
import type { Entity } from '@worldsea/entity-core'

const props = defineProps<{
  entity: Entity
  coverFieldKey: string
}>()

const coverValue = computed(() => {
  return props.entity.coverImage || props.entity.properties[props.coverFieldKey]
})

const hasCover = computed(() => {
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
  const pos = props.entity.coverPosition || '50% 50%'
  const zoom = props.entity.coverZoom || 1
  return {
    objectPosition: pos,
    transform: `scale(${zoom})`,
    transformOrigin: pos,
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
.card-cover-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 62%, rgba(0, 0, 0, 0.16));
  pointer-events: none;
}
</style>
