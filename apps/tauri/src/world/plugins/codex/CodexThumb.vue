<template>
  <img v-if="url" :src="url" class="cx-thumb" :alt="name">
  <span v-else class="cx-thumb cx-thumb--empty" aria-hidden="true"></span>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useEntityImage } from '@worldsea/entity-core/composables'
import type { Entity } from '@worldsea/entity-core'

const props = defineProps<{ entity: Entity }>()

/** 封面取值：勾选形象作封面用形象图，否则顶层封面，画板回落作品缩略图 */
const coverValue = computed(() => {
  const e = props.entity
  if (e.coverSource === 'portrait' && e.portrait) return e.portrait
  return e.coverImage || e.properties?.thumbnail
})

const { imageUrl: url } = useEntityImage(coverValue)
const name = computed(() => props.entity.name)
</script>
<style scoped>
.cx-thumb {
  width: 40px; height: 40px; border-radius: var(--radius-xs); object-fit: cover;
  border: 1px solid var(--color-border); background: var(--color-bg-hover); flex-shrink: 0;
}
.cx-thumb--empty { display: inline-block; }
</style>
