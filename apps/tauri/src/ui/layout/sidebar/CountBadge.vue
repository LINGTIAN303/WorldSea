<script setup lang="ts">
/**
 * CountBadge：侧边栏芽实体数量徽记（2026-09-13）
 * 用 Tabler 数字图标逐位拼接表示数量（IconNumber0Small~IconNumber9Small，
 * 一位一图横向排列，位数随数量自然增长，如 12 → 1+2 两枚图标）。
 * 图标无文本语义，根元素 role=img + aria-label 提供可访问名称。
 */
import { computed, type Component } from 'vue'
import {
  IconNumber0Small,
  IconNumber1Small,
  IconNumber2Small,
  IconNumber3Small,
  IconNumber4Small,
  IconNumber5Small,
  IconNumber6Small,
  IconNumber7Small,
  IconNumber8Small,
  IconNumber9Small,
} from '@tabler/icons-vue'

const props = withDefaults(defineProps<{ value: number; size?: number }>(), { value: 0, size: 13 })

/** 数字位 → 图标组件映射（下标 0-9） */
const DIGIT_ICONS: Component[] = [
  IconNumber0Small,
  IconNumber1Small,
  IconNumber2Small,
  IconNumber3Small,
  IconNumber4Small,
  IconNumber5Small,
  IconNumber6Small,
  IconNumber7Small,
  IconNumber8Small,
  IconNumber9Small,
]

/** 数量 → 逐位图标序列（负数/非整数按 0 兜底） */
const digitIcons = computed(() => {
  const n = Math.max(0, Math.floor(Number.isFinite(props.value) ? props.value : 0))
  return String(n).split('').map(d => DIGIT_ICONS[Number(d)])
})
</script>

<template>
  <span class="num-count-badge" role="img" :aria-label="`${value} 个实体`">
    <component
      :is="comp"
      v-for="(comp, i) in digitIcons"
      :key="i"
      :size="size"
      :stroke-width="1.6"
    />
  </span>
</template>

<style scoped>
.num-count-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5px;
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
  border-radius: var(--radius-mid);
  padding: 2px 5px;
  margin-left: auto;
  flex-shrink: 0;
  line-height: 1;
}
</style>
