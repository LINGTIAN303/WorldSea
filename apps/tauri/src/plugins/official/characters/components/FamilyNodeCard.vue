<template>
  <div v-if="visible" class="fnc-card" :style="cardStyle" @click.stop>
    <div class="fnc-header">
      <span class="fnc-name">{{ character?.name }}</span>
      <span class="fnc-gender">{{ character?.properties?.gender || '?' }}</span>
    </div>
    <div class="fnc-info">
      <span v-if="character?.properties?.race" class="fnc-race">{{ character.properties.race }}</span>
    </div>
    <p class="fnc-desc">{{ shortDesc }}</p>
    <div class="fnc-actions">
      <button class="fnc-btn" @click="$emit('editRelation', characterId)">编辑关系</button>
      <button class="fnc-btn fnc-btn-primary" @click="$emit('viewDetail', characterId)">查看详情</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'

const props = defineProps<{
  visible: boolean
  characterId: string
  x: number
  y: number
}>()

defineEmits<{
  editRelation: [id: string]
  viewDetail: [id: string]
}>()

const entityStore = useEntityStore()

const character = computed(() => entityStore.entityMap.get(props.characterId))

const shortDesc = computed(() => {
  const d = character.value?.description || ''
  return d.length > 40 ? d.slice(0, 40) + '...' : d
})

const cardStyle = computed(() => ({
  left: `${props.x + 10}px`,
  top: `${props.y + 10}px`,
}))
</script>

<style scoped>
.fnc-card {
  position: absolute;
  z-index: 100;
  background: var(--card-bg, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  padding: 10px 12px;
  min-width: 180px;
  max-width: 240px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  pointer-events: auto;
}
.fnc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.fnc-name { font-weight: var(--font-weight-semibold); font-size: var(--font-size-base); color: var(--text-color); }
.fnc-gender { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--bg-secondary, #f5f5f5); padding: 1px 6px; border-radius: 4px; }
.fnc-info { margin-bottom: 4px; }
.fnc-race { font-size: var(--font-size-xs); color: var(--text-secondary); }
.fnc-desc { font-size: var(--font-size-sm); color: var(--text-tertiary); margin: 4px 0 8px; line-height: 1.4; }
.fnc-actions { display: flex; gap: 6px; }
.fnc-btn { font-size: var(--font-size-xs); padding: 3px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.fnc-btn:hover { background: var(--bg-secondary); }
.fnc-btn-primary { background: var(--primary, #7c3aed); color: #fff; border-color: var(--primary, #7c3aed); }
.fnc-btn-primary:hover { opacity: 0.9; }
</style>
