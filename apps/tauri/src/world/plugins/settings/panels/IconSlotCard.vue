<template>
  <div class="set-card deck-card ic-card" v-show="matchKeywords(searchQuery, keywords)">
    <div class="sc-head">
      <span>{{ title }}</span>
      <span class="ic-sub">{{ subtitle }}</span>
    </div>
    <div class="ic-search-row">
      <input v-model="query" class="set-input ic-input" type="text" :placeholder="placeholder" :aria-label="placeholder" />
      <label class="ic-filter"><input v-model="onlyChanged" type="checkbox" />只看已改</label>
    </div>
    <IconSlotList
      :groups="filteredGroups"
      :icon-of="iconOf"
      :source-of="sourceOf"
      :has-global="hasGlobal"
      :empty-text="emptyText"
      @edit="emit('edit', $event)"
      @reset="emit('reset', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { matchKeywords } from '@worldsea/ui-kit'
import type { IconOverrideSource } from '@worldsea/entity-core'
import type { IconSlotListGroup } from '@/world/iconPanelModel'
import type { IconSlot } from '@/world/iconSlots'
import IconSlotList from './IconSlotList.vue'

const props = withDefaults(defineProps<{
  title: string
  subtitle: string
  placeholder: string
  keywords: string
  searchQuery?: string
  groups: IconSlotListGroup[]
  iconOf: (slot: IconSlot) => string
  sourceOf: (slot: IconSlot) => IconOverrideSource
  hasGlobal: (slot: IconSlot) => boolean
  emptyText?: string
}>(), {
  searchQuery: '',
  emptyText: '没有匹配的图标',
})

const emit = defineEmits<{
  edit: [slot: IconSlot]
  reset: [slot: IconSlot]
}>()

const query = ref('')
const onlyChanged = ref(false)

const filteredGroups = computed(() => {
  const q = query.value.trim().toLowerCase()
  return props.groups
    .map(group => ({
      ...group,
      items: group.items.filter(slot => {
        if (onlyChanged.value && props.sourceOf(slot) === 'default') return false
        if (!q) return true
        return slot.label.toLowerCase().includes(q) || slot.key.toLowerCase().includes(q)
      }),
    }))
    .filter(group => group.items.length > 0)
})
</script>

<style scoped>
.ic-card { gap: 8px; }
.ic-sub { font-size: var(--text-micro-font-size, 10px); color: var(--text-tertiary); text-transform: none; letter-spacing: normal; font-weight: var(--font-weight-normal, 400); }
.ic-search-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ic-input { flex: 1; min-width: 0; }
.ic-filter { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; font-size: var(--font-size-xs, 12px); color: var(--text-secondary); cursor: pointer; }
.ic-filter input { accent-color: var(--primary, var(--color-primary)); }
</style>
