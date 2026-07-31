<template>
  <!-- 编辑模式：右键主菜单 -->
  <div v-if="ctxMenu.show && !adjoinSelectMode" class="rm-context-menu"
    :style="ctxPos(ctxMenu.x, ctxMenu.y, 160, 240)">
    <div class="rm-ctx-item" @click="$emit('ctxEdit')">编辑详情</div>
    <div class="rm-ctx-item" @click="$emit('ctxDelete')">删除区域</div>
    <div class="rm-ctx-item" @click="$emit('ctxAdjoin')">接壤</div>
    <div class="rm-ctx-divider"></div>
    <div class="rm-ctx-label">更改颜色</div>
    <div class="rm-ctx-colors">
      <button v-for="col in paletteColors" :key="col"
        class="rm-ctx-color-btn" :style="{ background: col }"
        @click="$emit('ctxSetColor', col)"></button>
    </div>
  </div>

  <!-- 接壤选择模式：确认菜单 -->
  <div v-if="ctxMenu.show && adjoinSelectMode" class="rm-context-menu"
    :style="ctxPos(ctxMenu.x, ctxMenu.y, 160, 80)">
    <div class="rm-ctx-item" @click="$emit('executeAdjoin')">确认接壤 ({{ adjoinSelectedIds.size }})</div>
    <div class="rm-ctx-item" @click="$emit('cancelAdjoin')">取消</div>
  </div>

  <!-- 抹除边境线菜单 -->
  <div v-if="eraseCtxMenu.show" class="rm-context-menu"
    :style="ctxPos(eraseCtxMenu.x, eraseCtxMenu.y, 160, 120)">
    <div class="rm-ctx-label">抹除边境线</div>
    <div class="rm-ctx-item" @click="$emit('eraseMerge')">融合</div>
    <div class="rm-ctx-item" @click="$emit('eraseMoveLine')">移线</div>
    <div class="rm-ctx-divider"></div>
    <div class="rm-ctx-item" @click="$emit('closeEraseCtx')">取消</div>
  </div>
</template>

<script setup lang="ts">
import { ctxPos } from './geometry'
import type { CtxMenuState, EraseCtxMenuState } from './types'

defineProps<{
  ctxMenu: CtxMenuState
  eraseCtxMenu: EraseCtxMenuState
  adjoinSelectMode: boolean
  adjoinSelectedIds: Set<string>
  paletteColors: string[]
}>()

defineEmits<{
  ctxEdit: []
  ctxDelete: []
  ctxAdjoin: []
  ctxSetColor: [color: string]
  executeAdjoin: []
  cancelAdjoin: []
  eraseMerge: []
  eraseMoveLine: []
  closeEraseCtx: []
}>()
</script>

<style scoped>
.rm-context-menu { position: fixed; z-index: calc(var(--z-overlay) + 1); background: var(--color-bg-surface); border: 1px solid var(--color-border-strong); border-radius: 8px; padding: 6px 0; min-width: 130px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); }
.rm-ctx-item { padding: 6px 14px; font-size: var(--font-size-sm); color: var(--color-text-primary); cursor: pointer; animation: ws-staircase 0.15s ease-out forwards; opacity: 0; }
.rm-ctx-item:nth-child(1) { animation-delay: 0ms; }
.rm-ctx-item:nth-child(2) { animation-delay: 25ms; }
.rm-ctx-item:nth-child(3) { animation-delay: 50ms; }
.rm-ctx-item:nth-child(4) { animation-delay: 75ms; }
.rm-ctx-item:nth-child(5) { animation-delay: 100ms; }
.rm-ctx-item:nth-child(6) { animation-delay: 125ms; }
.rm-ctx-item:nth-child(7) { animation-delay: 150ms; }
.rm-ctx-item:hover { background: #efe3c3; }
.rm-ctx-divider { height: 1px; background: #c4a95a; margin: 4px 8px; }
.rm-ctx-label { padding: 4px 14px 2px; font-size: var(--font-size-xs); color: #9a8050; }
.rm-ctx-colors { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 10px 8px; }
.rm-ctx-color-btn { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.rm-ctx-color-btn:hover { border-color: var(--color-text-primary); }
</style>
