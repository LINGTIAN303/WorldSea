<template>
  <div class="chart-bar-renderer" ref="chartRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, inject } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

echarts.use([BarChart, TitleComponent, TooltipComponent, GridComponent, CanvasRenderer])

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const val = getComputedStyle(document.documentElement).getPropertyValue(name.replace(/^var\(--/, '').replace(/\)$/, '')).trim()
  return val || fallback
}

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const chartRef = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

function buildOption() {
  const list = ctx?.filteredList.value || []
  const labelField = (props.config.labelField as string) || 'name'
  const valueField = (props.config.valueField as string) || ''
  const title = (props.config.title as string) || ''

  const labels = list.map(e => labelField === 'name' ? e.name : e.properties?.[labelField] ?? '')
  const values = valueField
    ? list.map(e => Number(e.properties?.[valueField]) || 0)
    : list.map(() => 1)

  return {
    title: { text: title, left: 'center', textStyle: { fontSize: 14, color: cssVar('--text-secondary', '#6b7280') } },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 16, top: title ? 40 : 16, bottom: 30 },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11, color: cssVar('--text-tertiary', '#9ca3af') } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11, color: cssVar('--text-tertiary', '#9ca3af') } },
    series: [{ type: 'bar', data: values, itemStyle: { color: '#4f46e5', borderRadius: [4, 4, 0, 0] } }],
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
.chart-bar-renderer { width: 100%; height: 100%; min-height: 200px; }
</style>
