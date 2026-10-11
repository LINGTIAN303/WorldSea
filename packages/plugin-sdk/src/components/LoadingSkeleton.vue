<template>
  <div class="skeleton-list">
    <div v-for="i in rows" :key="i" class="skeleton-row" :style="{ animationDelay: (i * 0.08) + 's' }">
      <div class="skeleton-cell skeleton-cell-sm"></div>
      <div class="skeleton-cell skeleton-cell-lg"></div>
      <div class="skeleton-cell skeleton-cell-md"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ rows?: number }>()
</script>

<style scoped>
.skeleton-list { padding: 8px; }
.skeleton-row {
  display: flex; gap: 12px; align-items: center;
  padding: 12px 8px; border-bottom: 1px solid var(--bg-tertiary);
  animation: sk-pulse 1.5s ease-in-out infinite;
}
.skeleton-cell { height: 14px; border-radius: 4px; background: var(--bg-tertiary); }
.skeleton-cell-sm { width: 40px; flex-shrink: 0; }
.skeleton-cell-lg { flex: 1; }
.skeleton-cell-md { width: 80px; flex-shrink: 0; }
@keyframes sk-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
</style>
