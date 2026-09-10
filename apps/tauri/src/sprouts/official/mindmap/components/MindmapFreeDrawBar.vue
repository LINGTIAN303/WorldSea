<template>
  <div v-if="visible" class="mm-freedraw-bar">
    <span class="mm-freedraw-label"><WsIcon name="brush" size="xs" /> 绘图</span>
    <button
      v-for="c in colorPresets" :key="c"
      class="mm-freedraw-color"
      :class="{ active: drawColor === c }"
      :style="{ background: c }"
      @click="$emit('update:drawColor', c)"
    ></button>
    <select class="mm-freedraw-width" :value="drawWidth" @change="$emit('update:drawWidth', Number(($event.target as HTMLSelectElement).value))">
      <option value="2">细</option>
      <option value="3">中</option>
      <option value="5">粗</option>
      <option value="8">超粗</option>
    </select>
    <button class="mm-btn-sm" @click="$emit('undo')">撤销</button>
    <button class="mm-btn-sm" @click="$emit('clear')"><WsIcon name="delete" size="xs" /> 清除</button>
    <button class="mm-btn-sm" @click="$emit('exit')"><WsIcon name="close" size="xs" /> 退出</button>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'

defineProps<{
  visible: boolean
  colorPresets: string[]
  drawColor: string
  drawWidth: number
}>()

defineEmits<{
  (e: 'update:drawColor', v: string): void
  (e: 'update:drawWidth', v: number): void
  (e: 'undo'): void
  (e: 'clear'): void
  (e: 'exit'): void
}>()
</script>

<style scoped>
.mm-freedraw-bar {
  position: absolute; top: 50px; left: 50%; transform: translateX(-50%);
  background: var(--card-bg); border: 1px solid var(--border-color);
  border-radius: var(--radius-lg); padding: 6px 12px;
  box-shadow: var(--shadow-xl); display: flex; align-items: center; gap: 6px;
  z-index: 100;
}
.mm-freedraw-label { font-size: var(--font-size-sm); color: var(--text-tertiary); white-space: nowrap; }
.mm-freedraw-color {
  width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent;
  cursor: pointer; transition: border-color 0.15s;
}
.mm-freedraw-color.active { border-color: #fff; }
.mm-freedraw-color:hover { border-color: rgba(255,255,255,0.5); }
.mm-freedraw-width {
  background: var(--bg); border: 1px solid var(--border-color); border-radius: var(--radius-sm);
  color: var(--text-color); font-size: var(--font-size-xs); padding: 2px 4px;
}
.mm-btn-sm { padding: 4px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: transparent; cursor: pointer; font-size: var(--font-size-sm); }
.mm-btn-sm:hover { background: var(--hover-bg); }
</style>
