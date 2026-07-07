<template>
  <div class="chart-pie-renderer" ref="chartRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, inject } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const val = getComputedStyle(document.documentElement).getPropertyValue(name.replace(/^var\(--/, '').replace(/\)$/, '')).trim()
  return val || fallback
}

echarts.use([PieChart, TitleComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const chartRef = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

function buildOption() {
  const list = ctx?.filteredList.value || []
  const labelField = (props.config.labelField as string) || 'name'
  const valueField = (props.config.valueField as string) || ''
  const title = (props.config.title as string) || ''

  const data = list.map(e => ({
    name: labelField === 'name' ? e.name : String(e.properties?.[labelField] ?? ''),
    value: valueField ? Number(e.properties?.[valueField]) || 0 : 1,
  }))

  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 14, color: cssVar('--text-secondary', '#6b7280') } },
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['35%', '65%'],
      center: ['50%', '55%'],
      data,
      label: { fontSize: 11, color: cssVar('--text-secondary', '#6b7280') },
      itemStyle: { borderRadius: 4 },
    }],
  }
}

function renderChart() {
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  chart.setOption(buildOption(), true)
}

onMounted(() => {
  renderChart()
  const ro = new ResizeObserver(() => chart?.resize())
  if (chartRef.value) ro.observe(chartRef.value)
  onBeforeUnmount(() => {
    ro.disconnect()
    chart?.dispose()
    chart = null
  })
})

watch(() => ctx?.filteredList.value, renderChart, { deep: true })
</script>

<style scoped>
.chart-pie-renderer { width: 100%; height: 100%; min-height: 200px; }
</style>
