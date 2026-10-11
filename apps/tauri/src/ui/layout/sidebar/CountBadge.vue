<script setup lang="ts">
/**
 * CountBadge：侧边栏芽实体数量徽记（2026-09-13）
 * 用 Tabler 数字图标逐位拼接表示数量（IconNumber0Small~IconNumber9Small，
 * 一位一图横向排列，位数随数量自然增长，如 12 → 1+2 两枚图标）。
 * 图标无文本语义，根元素 role=img + aria-label 提供可访问名称。
 *
 * 排版要点：Tabler Number Small 图标的字形只占 24 画布中央 4/24 宽
 * （x∈[10,14]，如「1」仅 1u 宽），整枚 SVG 渲染时两侧各 ~12px 空白——
 * flex gap 归零也无效（空隙在 SVG 内部）。故每位用紧贴字形的窄槽位
 * （4.5px）做布局，SVG 绝对居中溢出画布留白，实现视觉紧排。
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

const props = withDefaults(defineProps<{ value: number; size?: number }>(), { value: 0, size: 16 })

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
    <span class="digit" v-for="(comp, i) in digitIcons" :key="i">
      <component :is="comp" class="digit-svg" :stroke-width="1.6" />
    </span>
  </span>
</template>

<style scoped>
/* 无底壳：只渲染数字图标本身，靠 margin-left:auto 推到行尾 */
.num-count-badge {
  display: inline-flex;
  align-items: center;
  color: var(--text-tertiary);
  margin-left: auto;
  flex-shrink: 0;
  line-height: 1;
}
/* 每位一个紧贴字形的窄槽位；SVG 绝对居中、溢出槽位覆盖画布留白 */
.digit {
  position: relative;
  width: 4.5px;
  height: 16px;
  display: inline-block;
}
.digit :deep(.digit-svg) {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 16px;
  height: 16px;
}
</style>
