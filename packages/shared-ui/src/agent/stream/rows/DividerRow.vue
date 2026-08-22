<!--
  DividerRow：时间 / 轮次分隔线
  有 dividerText 用文本，否则按时间戳推导「今天/昨天/HH:MM 或 月日 HH:MM」。
  纯扁平弱化分隔，无卡片/彩边。
-->
<template>
  <div class="ws-stream-row ws-stream-divider">
    <span>{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/** 事件行 props：仅需 divider 的文本与时间戳 */
const props = defineProps<{
  dividerText?: string
  timestamp?: number
}>()

/** 格式化为 HH:MM */
function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/** 时间分隔文案：今天/昨天/月日+时分 */
const label = computed(() => {
  if (props.dividerText) return props.dividerText
  const ts = props.timestamp
  if (!ts) return ''
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  if (ts >= todayStart) return `今天 ${hhmm(ts)}`
  if (ts >= yesterdayStart) return `昨天 ${hhmm(ts)}`
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm(ts)}`
})
</script>