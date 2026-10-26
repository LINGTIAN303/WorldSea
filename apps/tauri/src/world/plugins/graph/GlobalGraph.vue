<template>
  <div
    ref="viewRef"
    class="graph-view"
    :class="{ 'graph-view--theme': graphThemeMode === 'theme' }"
  >
    <div class="g-canvas-wrap">
      <GraphCanvas
        ref="canvasRef"
        :key="graphThemeMode"
        :theme-mode="graphThemeMode"
        @node-click="onNodeClick"
        @node-dbl-click="onNodeDblClick"
        @combo-click="onComboClick"
        @background-click="onBackgroundClick"
        @hover="onHover"
        @zoom-change="onZoomChange"
        @render-error="onRenderError"
      />
      <WsLoadingOverlay
        :show="graphLoading"
        scope="panel"
        title="正在构建世界地图"
        success-title="世界地图已就绪"
        error-title="世界地图构建失败"
        :stages="GRAPH_LOAD_STAGES"
        :current="graphStage"
        :status="graphStatus"
        :error="graphError ?? renderError ?? ''"
        error-text="无法载入实体与关系数据"
        :closable="false"
        @retry="retry"
      />
    </div>

    <div v-if="graphLoaded && entityCount === 0" class="g-empty">
      <WsEmpty preset="no-data" title="图谱为空" description="创建实体后会自动显示在这里">
        <template #icon><WsIcon name="graph" size="xl" /></template>
      </WsEmpty>
    </div>

    <GraphHud
      :stats="overview.stats"
      :search-query="searchQuery"
      :search-count="searchCount"
      :mode="mode"
      :legend-open="legendOpen"
      :path-open="pathOpen"
      :timeline-open="timelineOpen"
      :timeline-active="timelineActive"
      :timeline-dated="timelineDated"
      :zoom-pct="zoomPct"
      @update:search="onSearch"
      @search-enter="onSearchEnter"
      @clear-search="clearSearch"
      @set-mode="setMode"
      @toggle-path="togglePathPanel"
      @toggle-timeline="toggleTimelinePanel"
      @toggle-legend="legendOpen = !legendOpen"
      @fit="fitView"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
    />

    <PathPanel
      :visible="pathOpen"
      :nodes="overview.nodes"
      :result="pathResult"
      :message="pathMessage"
      @close="closePath"
      @run="runPath"
      @clear="clearPath"
    />

    <TimelinePanel
      :visible="timelineOpen"
      :min="timelineMin"
      :max="timelineMax"
      :start="timelineStart"
      :end="timelineEnd"
      :dated-count="timelineDated"
      :total-count="entityCount"
      :active="timelineActive"
      @close="closeTimelinePanel"
      @update:range="onTimelineRange"
      @reset="resetTimeline"
    />

    <GraphStats :stats="overview.stats" />

    <div v-if="focus" class="g-focus-chip">
      <WsIcon name="target" size="xs" />
      <span class="g-focus-chip__text">已聚焦「{{ focus.name }}」· {{ focus.count }} 个邻居</span>
      <button class="g-focus-chip__exit" @click="exitFocus">返回全图</button>
    </div>

    <GraphLegendPanel
      :visible="legendOpen"
      :types="overview.types"
      :hidden-types="hiddenTypes"
      :hidden-families="hiddenFamilies"
      :communities="communities"
      :community-count="communityCount"
      :show-communities="showCommunities"
      :theme-mode="graphThemeMode"
      @close="legendOpen = false"
      @toggle-type="toggleType"
      @toggle-family="toggleFamilyFilter"
      @toggle-community="toggleCommunities"
      @focus-type="onFocusType"
    />

    <GraphTypePanel
      :visible="!!activeGroup"
      :group="activeGroup"
      :nodes="activeGroupNodes"
      @close="activeGroupId = null"
      @select-node="onSelectTypeNode"
    />

    <GraphInspector
      :visible="!!selectedNode"
      :node="selectedNode"
      :relations="inspectorRelations"
      :theme-mode="graphThemeMode"
      @close="exitFocus"
      @navigate="goTo"
      @focus="onFocusNode"
      @select-relation="onSelectRelation"
    />

    <div v-if="hover && tooltipText" class="g-tooltip" :style="tooltipStyle">{{ tooltipText }}</div>
  </div>
</template>

<script setup lang="ts">
import { WsEmpty, WsIcon, WsLoadingOverlay, type LoadingStage } from '@worldsea/ui-kit'
import GraphCanvas from './view/GraphCanvas.vue'
import GraphHud from './view/GraphHud.vue'
import GraphStats from './view/GraphStats.vue'
import GraphLegendPanel from './view/GraphLegendPanel.vue'
import GraphTypePanel from './view/GraphTypePanel.vue'
import GraphInspector from './view/GraphInspector.vue'
import PathPanel from './view/PathPanel.vue'
import TimelinePanel from './view/TimelinePanel.vue'
import { useGraphView } from './composables/useGraphView'

const GRAPH_LOAD_STAGES: LoadingStage[] = [
  { short: '数据', full: '载入实体与关系' },
  { short: '布局', full: '构建世界地图' },
]

const {
  viewRef,
  canvasRef,
  graphThemeMode,
  overview,
  entityCount,
  graphLoading,
  graphStage,
  graphStatus,
  graphError,
  graphLoaded,
  renderError,
  zoomPct,
  legendOpen,
  mode,
  hiddenTypes,
  hiddenFamilies,
  communities,
  communityCount,
  showCommunities,
  pathOpen,
  pathResult,
  pathMessage,
  timelineOpen,
  timelineStart,
  timelineEnd,
  timelineMin,
  timelineMax,
  timelineActive,
  timelineDated,
  searchQuery,
  searchCount,
  activeGroupId,
  activeGroup,
  activeGroupNodes,
  selectedNode,
  inspectorRelations,
  focus,
  hover,
  tooltipText,
  tooltipStyle,
  onNodeClick,
  onNodeDblClick,
  onComboClick,
  onBackgroundClick,
  onSelectTypeNode,
  onSearch,
  onSearchEnter,
  clearSearch,
  toggleType,
  toggleFamilyFilter,
  toggleCommunities,
  togglePathPanel,
  closePath,
  runPath,
  clearPath,
  onTimelineRange,
  resetTimeline,
  toggleTimelinePanel,
  closeTimelinePanel,
  setMode,
  onFocusType,
  onFocusNode,
  onSelectRelation,
  goTo,
  onHover,
  onZoomChange,
  onRenderError,
  exitFocus,
  zoomIn,
  zoomOut,
  fitView,
  retry,
} = useGraphView()

// 模板 ref 走字符串绑定，TS 看不到表达式使用；显式 touch 避免 noUnusedLocals 误报
void viewRef
void canvasRef
</script>

<style scoped>
.graph-view {
  position: relative;
  height: 100%;
  overflow: hidden;
  --g-canvas: #070b13;
  --g-panel-bg: rgba(8, 12, 20, 0.92);
  --g-panel-border: rgba(255, 255, 255, 0.1);
  --g-text: #cbd5e1;
  --g-text-strong: #e2e8f0;
  --g-text-dim: #94a3b8;
  --g-hover: rgba(255, 255, 255, 0.08);
  --g-accent: #6ea8fe;
  background: var(--g-canvas);
}
.graph-view--theme {
  --g-canvas: var(--color-bg-surface, #f8fafc);
  --g-panel-bg: color-mix(in srgb, var(--color-bg-elevated, #ffffff) 94%, transparent);
  --g-panel-border: var(--color-border, #dbe3ee);
  --g-text: var(--color-text-secondary, #475569);
  --g-text-strong: var(--color-text-primary, #1e293b);
  --g-text-dim: var(--color-text-tertiary, #64748b);
  --g-hover: var(--color-bg-hover, rgba(0, 0, 0, 0.06));
  --g-accent: var(--color-primary, #4f6ef7);
}
.g-canvas-wrap { position: absolute; inset: 0; }
.g-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 2;
}
.g-focus-chip {
  position: absolute; top: 56px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; padding: 6px 12px;
  border: 1px solid var(--g-panel-border, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-mid); background: var(--g-panel-bg, rgba(8, 12, 20, 0.92));
  color: var(--g-text, #cbd5e1); font-size: var(--font-size-xs); z-index: 7;
  backdrop-filter: blur(8px);
}
.g-focus-chip__text { white-space: nowrap; }
.g-focus-chip__exit {
  border: 1px solid var(--g-panel-border, rgba(255, 255, 255, 0.2));
  background: transparent; color: var(--g-text-strong, #e2e8f0);
  border-radius: var(--radius-sm); padding: 2px 8px; cursor: pointer;
  font-size: var(--font-size-xs);
}
.g-focus-chip__exit:hover { background: var(--g-hover, rgba(255, 255, 255, 0.1)); }
.g-tooltip {
  position: absolute; pointer-events: none; z-index: var(--z-dropdown);
  max-width: 260px; padding: 6px 10px;
  border: 1px solid var(--g-panel-border, rgba(255, 255, 255, 0.1));
  border-radius: var(--radius-sm); background: var(--g-panel-bg, rgba(8, 12, 20, 0.92));
  color: var(--g-text, #cbd5e1); font-size: var(--font-size-sm); line-height: 1.5;
  backdrop-filter: blur(6px);
}
</style>
