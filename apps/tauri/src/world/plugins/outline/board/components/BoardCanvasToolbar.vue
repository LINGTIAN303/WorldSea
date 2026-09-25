<template>
  <!--
    画布级悬浮工具条（BoardCanvasToolbar）
    规格：docs/plans/2026-09-16-大纲白板-编辑器交互规格.md §一（网格与吸附）/ §二（画区）
    · 与视图工具条（`bar`）分工：视图条管白板级（返回/名称/保存/撤销/缩放），本悬浮条管**画布级**工具
    · 悬浮在画布左下角，不占布局空间（DOM 绝对定位）
  -->
  <div class="bct">
    <button
      class="bct-btn"
      type="button"
      :class="{ 'bct-btn--on': drawing }"
      :title="drawing ? '退出画区模式（Esc）' : '画区：在画布上拖出矩形'"
      @click="$emit('toggleDraw')"
    >
      <WsIcon name="square-dashed" size="xs" />
      <span>画区</span>
    </button>

    <span class="bct-sep" />

    <!-- 吸附模式：三态分段 -->
    <span class="bct-group" role="group" aria-label="吸附模式">
      <button
        v-for="m in SNAP_MODES"
        :key="m.value"
        class="bct-seg"
        type="button"
        :class="{ 'bct-seg--on': snapMode === m.value }"
        :title="m.hint"
        @click="$emit('setSnap', m.value)"
      >{{ m.label }}</button>
    </span>

    <button
      class="bct-btn"
      type="button"
      :class="{ 'bct-btn--on': gridEnabled }"
      :title="gridEnabled ? '隐藏背景网格' : '显示背景网格'"
      @click="$emit('toggleGrid')"
    >
      <WsIcon name="tactical-board" size="xs" />
      <span>网格</span>
    </button>

    <span class="bct-sep" />

    <button class="bct-btn" type="button" title="适配全部 (Shift+1)" @click="$emit('fitAll')">
      <WsIcon name="align-center-horizontal" size="xs" />
      <span>适配</span>
    </button>

    <!-- 悬空容器（节点已删）清理：只在存在时出现，且必须用户点击，绝不自动删 -->
    <button
      v-if="danglingCount > 0"
      class="bct-btn bct-btn--warn"
      type="button"
      :title="`清理 ${danglingCount} 个节点已删除的容器（只删容器，不影响其他数据）`"
      @click="$emit('cleanupDangling')"
    >
      <WsIcon name="x-circle" size="xs" />
      <span>清理悬空容器 {{ danglingCount }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 画布悬浮工具条：纯展示 + 事件上报，不持有业务状态（状态都在 BoardView / useBoardLayout）。
 */
import { WsIcon } from '@worldsea/ui-kit'
import type { SnapMode } from '../composables/useBoardSnap'

defineProps<{
  snapMode: SnapMode
  gridEnabled: boolean
  drawing: boolean
  /** 悬空容器数量（>0 才显示清理入口） */
  danglingCount: number
}>()

defineEmits<{
  (e: 'toggleDraw'): void
  (e: 'setSnap', mode: SnapMode): void
  (e: 'toggleGrid'): void
  (e: 'fitAll'): void
  (e: 'cleanupDangling'): void
}>()

const SNAP_MODES: Array<{ value: SnapMode; label: string; hint: string }> = [
  { value: 'guides', label: '辅助线', hint: '拖动时显示对齐辅助线并在 6px 内吸附（默认）' },
  { value: 'grid', label: '网格', hint: '拖动时吸附到 20px 网格' },
  { value: 'off', label: '关闭', hint: '不吸附（完全自由摆放）' },
]
</script>

<style scoped>
.bct {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  background: var(--menubar-bg, var(--bg-secondary));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
.bct-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  /* 图标按钮必须显式设色（WsIcon 走 currentColor），否则暗色主题下不可见 */
  color: var(--text-secondary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
}
.bct-btn:hover { background: var(--hover-bg); color: var(--primary); }
.bct-btn--on { background: var(--hover-bg); color: var(--primary); border-color: var(--primary); }
.bct-btn--warn { color: var(--warning, #d97706); }
.bct-btn--warn:hover { color: var(--warning, #d97706); }
.bct-group {
  display: inline-flex;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xs);
  overflow: hidden;
}
.bct-seg {
  height: 22px;
  padding: 0 7px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
}
.bct-seg:hover { background: var(--hover-bg); }
.bct-seg--on { background: var(--hover-bg); color: var(--primary); font-weight: var(--font-weight-medium); }
.bct-sep { width: 1px; height: 14px; background: var(--border-light); }
</style>
