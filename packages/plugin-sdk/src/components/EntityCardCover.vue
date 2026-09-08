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
