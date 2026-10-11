<template>
  <img v-if="coverUrl" :src="coverUrl" :alt="entity.name" :style="coverStyle" />
  <div v-else class="card-back-empty">
    <WsIcon name="image" size="xl" />
    <span>暂无图片</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEntityImage } from '@worldsea/entity-core/composables'
import type { Entity } from '@worldsea/entity-core'
import { WsIcon } from '@worldsea/ui-kit'

const props = defineProps<{
  entity: Entity
  coverFieldKey: string
}>()

const coverValue = computed(() => {
  return props.entity.coverImage || props.entity.properties[props.coverFieldKey]
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
.card-back-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  height: 100%;
}
</style>
