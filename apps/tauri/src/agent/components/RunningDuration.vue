<script setup lang="ts">
/**
 * RunningDuration：子 Agent 运行耗时实时文本（独立小组件）
 *
 * 自身每秒刷新耗时显示，与父列表隔离——避免父组件因全局 now ref
 * 每秒触发整列表（v-for）重渲染（批次100 P3，性能隔离）。
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  /** 委派开始时间戳（ms） */
  startedAt: number
}>()

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

/** 运行耗时（相对起始时刻的实时值） */
const label = computed(() => {
  const ms = Math.max(0, now.value - props.startedAt)
  if (ms < 1000) return '刚刚开始'
  if (ms < 60000) return `已运行 ${Math.floor(ms / 1000)} 秒`
  const s = Math.floor(ms / 1000)
  return `已运行 ${Math.floor(s / 60)} 分 ${s % 60} 秒`
})
</script>

<template>
  <span>{{ label }}</span>
</template>
