<template>
  <span class="tpl-icon">
    <component :is="iconComp" v-if="iconComp" :size="size" :stroke-width="1.7" aria-hidden="true" />
    <span v-else class="tpl-icon-text">{{ name }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  IconCrown,
  IconWand,
  IconUser,
  IconNetwork,
  IconClipboardText,
  IconSparkles,
} from '@tabler/icons-vue'

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 20 })

/**
 * 模板图标统一渲染（2026-09-09 存量 emoji 迁移：模板/项目 icon 从 emoji 迁移为
 * tabler 图标名）。已知名 → tabler SVG 图标；未知名（含历史 emoji / 用户旧数据）
 * 原样渲染文本，保证存量数据不破坏。
 */
const ICON_MAP: Record<string, unknown> = {
  crown: IconCrown,
  magic: IconWand,
  wand: IconWand,
  character: IconUser,
  user: IconUser,
  network: IconNetwork,
  clipboard: IconClipboardText,
  sparkles: IconSparkles,
}

const iconComp = computed(() => ICON_MAP[props.name] ?? null)
</script>

<style scoped>
.tpl-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.tpl-icon svg {
  display: block;
}
.tpl-icon-text {
  font-size: inherit;
  line-height: 1;
  opacity: 0.75;
}
</style>