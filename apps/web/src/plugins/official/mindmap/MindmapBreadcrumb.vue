<template>
  <div v-if="breadcrumb.length > 1" class="mm-breadcrumb">
    <template v-for="(item, i) in breadcrumb" :key="i">
      <span v-if="i > 0" class="mm-bc-sep">›</span>
      <button
        class="mm-bc-item"
        :class="{ active: i === breadcrumb.length - 1 }"
        @click="$emit('jump', item.id)"
      >{{ item.name }}</button>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  breadcrumb: { id: string | null; name: string }[]
}>()

defineEmits<{
  jump: [id: string | null]
}>()
</script>

<style scoped>
.mm-breadcrumb {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 12px; background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
  font-size: var(--font-size-sm); flex-shrink: 0;
}
.mm-bc-sep { color: var(--text-tertiary); }
.mm-bc-item {
  background: none; border: none; cursor: pointer;
  color: var(--text-secondary); font-size: var(--font-size-sm);
  padding: 2px 6px; border-radius: 4px;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast);
}
.mm-bc-item:hover { background: var(--hover-bg); color: var(--text-color); }
.mm-bc-item.active { color: var(--primary); font-weight: var(--font-weight-semibold); }
</style>
