<template>
  <slot />
</template>

<script setup lang="ts">
/**
 * 面板包装组件
 * - 通过 provide 注入 moduleViewId，供面板内视图组件使用
 * - 等价于原文件中的 defineComponent({ setup(props, { slots }) { ... } })
 */
import { computed, provide } from 'vue'

const props = defineProps<{ viewId: string }>()

provide('moduleViewId', computed(() => props.viewId || ''))
</script>
