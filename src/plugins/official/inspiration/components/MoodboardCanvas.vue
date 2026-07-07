<template>
  <div ref="containerRef" class="mb-container"></div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useMoodboardRenderer } from '../composables/useMoodboardRenderer'
import { useMoodboardInteraction } from '../composables/useMoodboardInteraction'
import type { CardData } from '../composables/moodboardDraw'

const props = defineProps<{
  cards: CardData[]
  selectedCardId: string | null
}>()

const emit = defineEmits<{
  (e: 'cardClick', card: CardData): void
  (e: 'cardDoubleClick', card: CardData): void
  (e: 'cardRightClick', card: CardData): void
  (e: 'cardDragEnd', card: CardData, x: number, y: number): void
  (e: 'backgroundClick'): void
}>()

const containerRef = ref<HTMLElement | null>(null)
const hoveredCardId = ref<string | null>(null)
const dragPreview = ref<{ id: string; x: number; y: number } | null>(null)

const renderData = computed(() => ({
  cards: props.cards,
  selectedCardId: props.selectedCardId,
  hoveredCardId: hoveredCardId.value,
  dragPreview: dragPreview.value,
}))

const renderer = useMoodboardRenderer(containerRef, renderData)
const interaction = useMoodboardInteraction(
  renderer.canvas,
  renderer.screenToWorld,
  renderer.hitTest,
  renderer.getCamera,
  renderer.setCamera,
  renderer.markDirty,
)

interaction.setCallbacks({
  onCardClick(card) { emit('cardClick', card) },
  onCardDoubleClick(card) { emit('cardDoubleClick', card) },
  onCardRightClick(card) { emit('cardRightClick', card) },
  onCardDrag(card, dx, dy) {
    card.x += dx
    card.y += dy
    dragPreview.value = { id: card.id, x: card.x, y: card.y }
    renderer.markDirty()
  },
  onCardDragEnd(card) {
    dragPreview.value = null
    emit('cardDragEnd', card, card.x, card.y)
    renderer.markDirty()
  },
  onBackgroundClick() { emit('backgroundClick') },
  onZoom() { renderer.markDirty() },
  onPan() { renderer.markDirty() },
})

watch(
  () => [props.cards, props.selectedCardId],
  () => { renderer.markDirty() },
  { deep: true },
)

onMounted(() => {
  renderer.init()
  interaction.bindEvents()
})

onBeforeUnmount(() => {
  interaction.unbindEvents()
  renderer.destroy()
})

defineExpose({ fitBoard: () => {}, getCamera: renderer.getCamera, setCamera: renderer.setCamera })
</script>

<style scoped>
.mb-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
</style>
