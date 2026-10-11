<template>
  <div class="rm-toolbar">
    <button class="rm-btn" :class="{ on: mode === 'pan' }" @click="$emit('update:mode', 'pan')" title="浏览"><WsIcon name="image" size="xs" /></button>
    <button class="rm-btn" :class="{ on: mode === 'edit' }" @click="$emit('update:mode', 'edit')" title="编辑"><WsIcon name="edit" size="xs" /></button>
    <button class="rm-btn" :class="{ on: mode === 'draw' }" @click="$emit('startDrawMode')" title="绘制"><WsIcon name="brush" size="xs" /></button>
    <span class="rm-sep">|</span>
    <button class="rm-btn" @click="$emit('zoomIn')">+</button>
    <span class="rm-zoom">{{ Math.round(scale * 100) }}%</span>
    <button class="rm-btn" @click="$emit('zoomOut')">-</button>
    <button class="rm-btn" @click="$emit('fitAll')">适应</button>
    <span class="rm-mode-hint">当前: {{ modeLabel }}</span>
    <span class="rm-legend-hint" v-if="mode !== 'draw'">图例:
      <span v-for="item in legendTypes" :key="item.type" :style="{ color: item.color }">{{ item.type }} </span>
    </span>
    <template v-if="mode === 'draw'">
      <span class="rm-draw-hint" v-if="eraseMode === 'offset'">偏移模式：拖拽节点移动边境线，Enter确认，Esc取消</span>
      <span class="rm-draw-hint" v-else-if="eraseMode === 'redraw'">重划模式：绘制新的边境线</span>
      <span class="rm-draw-hint" v-else-if="!borderlineActive">点击地图开始绘制疆域边界</span>
      <span class="rm-draw-hint rm-borderline-hint" v-else>边境线模式：按住 Alt 绘制边境线（分割/增补）</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import WsIcon from '../../WsIcon.vue'
import type { MapMode, EraseMode, LegendItem } from './types'

defineProps<{
  mode: MapMode
  scale: number
  eraseMode: EraseMode
  borderlineActive: boolean
  legendTypes: LegendItem[]
  modeLabel: string
}>()

defineEmits<{
  'update:mode': [mode: MapMode]
  zoomIn: []
  zoomOut: []
  fitAll: []
  startDrawMode: []
}>()
</script>

<style scoped>
.rm-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--color-bg-surface); border-bottom: 1px solid var(--color-border-strong); flex-shrink: 0; flex-wrap: wrap; }
.rm-btn { padding: 4px 10px; border: 1px solid var(--color-border-strong); border-radius: 4px; background: var(--color-bg-elevated); cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-primary); }
.rm-btn:hover { background: #e8d8a8; }
.rm-btn.on { background: #c4a95a; color: #fff; }
.rm-sep { color: var(--color-border-strong); font-size: var(--font-size-base); margin: 0 2px; }
.rm-zoom { font-size: var(--font-size-xs); color: var(--color-text-secondary); width: 40px; text-align: center; }
.rm-mode-hint { font-size: var(--font-size-xs); color: #8b4513; margin-left: 4px; font-weight: var(--font-weight-semibold); }
.rm-legend-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-left: auto; display: flex; gap: 4px; }
.rm-legend-hint span { font-weight: bold; }
.rm-draw-hint { font-size: var(--font-size-xs); color: #e74c3c; margin-left: auto; font-style: italic; }
</style>
