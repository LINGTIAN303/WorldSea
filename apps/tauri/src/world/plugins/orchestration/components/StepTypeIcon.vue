<template>
  <span class="sti" :class="`sti--${type}`">
    <component :is="tablerIcon" v-if="tablerIcon" :size="size" :stroke-width="1.7" aria-hidden="true" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  IconRobot,
  IconEye,
  IconBox,
  IconClipboard,
  IconSearch,
  IconRepeat,
  IconTree,
  IconNetwork,
  IconUsers,
} from '@tabler/icons-vue'
import type { StepType } from '../types'

const props = withDefaults(defineProps<{ type: StepType; size?: number }>(), { size: 16 })

/**
 * 步骤类型图标统一渲染入口（2026-09-09 全量 tabler SVG 化，合规「禁止 emoji 图标」）。
 * 9 种步骤类型全部映射 tabler 图标；未知名（类型演进遗留）渲染空占位。
 */
const TABLER_MAP: Partial<Record<StepType, unknown>> = {
  'agent-task': IconRobot,
  'user-review': IconEye,
  'batch-create': IconBox,
  'template-apply': IconClipboard,
  'consistency-check': IconSearch,
  'transform': IconRepeat,
  'tot-search': IconTree,
  'got-solve': IconNetwork,
  'multi-agent': IconUsers,
}

const tablerIcon = computed(() => TABLER_MAP[props.type] ?? null)
</script>

<style scoped>
.sti {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.sti svg {
  display: block;
}
</style>