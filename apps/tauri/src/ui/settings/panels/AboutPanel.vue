<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx">
        <div class="sc-head">关于</div>
        <div class="about-body">
          <WorldSmithLogo :size="56" :radius="14" tone="auto" class="about-logo" />
          <h3 class="about-name">WorldSmith Agent</h3>
          <p class="about-version">版本 {{ appVersion }}</p>
        </div>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
/**
 * AboutPanel：全局设置「关于」Tab（2026-09-05 自左栏底部更多菜单迁入）。
 * 仅展示 Logo + 产品名 + 版本号；版本号由 Vite define 注入（__APP_VERSION__）。
 */
import { ref } from 'vue'
import { CardDeck } from '@worldsmith/ui-kit'
import WorldSmithLogo from '@/components/brand/WorldSmithLogo.vue'

declare const __APP_VERSION__: string
const appVersion = __APP_VERSION__

defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ 'card-change': [index: number] }>()
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)

defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })
</script>

<style scoped>
/* 基座样式（.set-card/.sc-head/.set-row/.set-toggle/.set-hint）已收敛至 ui-kit settings-panels.css，此处仅保留面板私有样式 */
.about-body { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px 0 8px; text-align: center; }
.about-logo { display: block; }
.about-name { margin: 10px 0 0; font-size: var(--font-size-base); font-weight: 600; color: var(--text-color); }
.about-version { margin: 0; font-size: var(--font-size-xs); color: var(--text-secondary, var(--color-text-secondary)); }
</style>
