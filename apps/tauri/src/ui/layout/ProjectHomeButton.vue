<template>
  <button
    type="button"
    class="titlebar-home"
    :class="{ 'is-active': isHome }"
    :aria-current="isHome ? 'page' : undefined"
    title="返回项目首页"
    aria-label="返回项目首页"
    @click="onClick"
  >
    <WorldSeaLogo :size="15" :radius="4" alt="" />
    <span class="titlebar-home-label">WorldSea</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUIStore } from '@/stores/uiStore'
import WorldSeaLogo from '@/components/brand/WorldSeaLogo.vue'

const ui = useUIStore()
const isHome = computed(() => ui.surface === 'home')

// 返回项目首页（已在首页时点击不改状态）
function onClick() {
  if (!isHome.value) ui.openHome()
}
</script>

<style scoped>
.titlebar-home {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  font-weight: 600;
  transition: background 0.12s, color 0.12s;
}
.titlebar-home:hover {
  background: var(--bg-hover, var(--color-bg-hover));
}
.titlebar-home.is-active {
  color: var(--accent);
}
.titlebar-home-label {
  white-space: nowrap;
}
</style>
