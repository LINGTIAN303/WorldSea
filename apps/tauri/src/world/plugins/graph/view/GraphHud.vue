<template>
  <div class="g-hud">
    <div class="g-hud-left">
      <span class="g-hud-title">世界总览</span>
      <span class="g-hud-sub">关系核心 {{ stats.connected }} · 类型 {{ stats.types }}</span>
    </div>

    <div class="g-hud-search">
      <WsIcon name="search" size="xs" class="g-hud-search-icon" />
      <input
        :value="searchQuery"
        class="g-hud-search-input"
        placeholder="搜索实体..."
        aria-label="搜索实体"
        @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
        @keydown.enter="$emit('search-enter')"
      />
      <span v-if="searchQuery.trim()" class="g-hud-search-count">{{ searchCount }} 处</span>
      <button v-if="searchQuery.trim()" class="g-hud-search-clear" aria-label="清空搜索" @click="$emit('clear-search')">
        <WsIcon name="close" size="xs" />
      </button>
    </div>

    <div class="g-hud-actions">
      <div class="g-hud-segment" role="group" aria-label="视图模式">
        <button class="g-hud-seg" :class="{ on: mode === 'overview' }" @click="$emit('set-mode', 'overview')">总览</button>
        <button class="g-hud-seg" :class="{ on: mode === 'relations' }" @click="$emit('set-mode', 'relations')">关系</button>
      </div>
      <button class="g-hud-btn" :class="{ on: pathOpen }" title="路径搜索" aria-label="路径搜索" @click="$emit('toggle-path')">
        <WsIcon name="route" size="xs" />
      </button>
      <button
        class="g-hud-btn"
        :class="{ on: timelineOpen, filtered: timelineActive }"
        :title="timelineDated > 0 ? `时间轴（${timelineDated} 个实体带日期）` : '时间轴（暂无带日期的实体）'"
        aria-label="时间轴"
        @click="$emit('toggle-timeline')"
      >
        <WsIcon name="timeline" size="xs" />
      </button>
      <button class="g-hud-btn" :class="{ on: legendOpen }" title="类型图例" aria-label="类型图例" @click="$emit('toggle-legend')">
        <WsIcon name="list" size="xs" />
      </button>
      <button class="g-hud-btn" title="适应画面" aria-label="适应画面" @click="$emit('fit')">
        <WsIcon name="expand" size="xs" />
      </button>
      <button class="g-hud-btn" title="缩小" aria-label="缩小" @click="$emit('zoom-out')">
        <WsIcon name="minus" size="xs" />
      </button>
      <button class="g-hud-btn" title="放大" aria-label="放大" @click="$emit('zoom-in')">
        <WsIcon name="plus" size="xs" />
      </button>
      <span class="g-hud-zoom">{{ zoomPct }}%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'
import type { OverviewStats } from '../model/types'

defineProps<{
  stats: OverviewStats
  searchQuery: string
  searchCount: number
  mode: 'overview' | 'relations'
  legendOpen: boolean
  pathOpen: boolean
  timelineOpen: boolean
  timelineActive: boolean
  timelineDated: number
  zoomPct: number
}>()

defineEmits<{
  'update:search': [value: string]
  'search-enter': []
  'clear-search': []
  'set-mode': [mode: 'overview' | 'relations']
  'toggle-path': []
  'toggle-timeline': []
  'toggle-legend': []
  fit: []
  'zoom-in': []
  'zoom-out': []
}>()
</script>

<style scoped>
.g-hud {
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 14px;
  pointer-events: none;
  z-index: 6;
}
.g-hud > * { pointer-events: auto; }
.g-hud-left { display: flex; flex-direction: column; gap: 2px; min-width: 150px; }
.g-hud-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--g-text-strong, #e2e8f0); letter-spacing: 0.04em; }
.g-hud-sub { font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); white-space: nowrap; }
.g-hud-search {
  display: flex; align-items: center; gap: 6px; min-width: 220px; max-width: 320px;
  padding: 5px 10px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1));
  border-radius: var(--radius-2xl); background: var(--g-panel-bg, rgba(8,12,20,0.92));
  backdrop-filter: blur(10px);
}
.g-hud-search-icon { color: var(--g-text-dim, #94a3b8); flex-shrink: 0; }
.g-hud-search-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: var(--g-text, #cbd5e1); font-size: var(--font-size-sm); }
.g-hud-search-input::placeholder { color: var(--g-text-dim, #94a3b8); }
.g-hud-search-count { font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); white-space: nowrap; }
.g-hud-search-clear { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border: none; border-radius: 50%; background: transparent; color: var(--g-text-dim, #94a3b8); cursor: pointer; }
.g-hud-search-clear:hover { color: var(--g-text-strong, #e2e8f0); background: var(--g-hover, rgba(255,255,255,0.08)); }
.g-hud-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.g-hud-segment { display: flex; padding: 2px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-2xl); background: var(--g-panel-bg, rgba(8,12,20,0.92)); backdrop-filter: blur(10px); }
.g-hud-seg { border: none; background: transparent; color: var(--g-text-dim, #94a3b8); font-size: var(--font-size-xs); padding: 3px 10px; border-radius: var(--radius-2xl); cursor: pointer; }
.g-hud-seg.on { color: var(--g-text-strong, #e2e8f0); background: var(--g-hover, rgba(255,255,255,0.1)); }
.g-hud-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1)); border-radius: var(--radius-sm); background: var(--g-panel-bg, rgba(8,12,20,0.92)); color: var(--g-text, #cbd5e1); cursor: pointer; backdrop-filter: blur(10px); transition: background 0.15s, color 0.15s; }
.g-hud-btn:hover { color: var(--g-text-strong, #e2e8f0); background: var(--g-hover, rgba(255,255,255,0.1)); }
.g-hud-btn.on { color: var(--g-accent, #6ea8fe); border-color: color-mix(in srgb, var(--g-accent, #6ea8fe) 55%, transparent); }
.g-hud-btn.filtered { position: relative; }
.g-hud-btn.filtered::after { content: ''; position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--g-accent, #6ea8fe); }
.g-hud-zoom { min-width: 38px; text-align: center; font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8); }
</style>
