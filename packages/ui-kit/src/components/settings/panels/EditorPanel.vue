<template>
  <div class="set-card" v-show="match('撤销 重做 undo redo 历史')">
    <div class="sc-head">撤销 / 重做</div>
    <div class="set-row"><span>撤销历史条数</span><input type="number" class="set-input set-input-sm" :value="store.undoHistoryLimit" min="5" max="100" @input="onUndoLimitChange" /></div>
    <div class="set-row"><span>多步重做</span><label class="set-toggle"><input type="checkbox" :checked="store.multiStepRedo" @change="store.multiStepRedo = ($event.target as HTMLInputElement).checked" /><span class="set-toggle-slider"></span></label></div>
    <div class="set-hint">关闭后 {{ formatKeyForDisplay('ctrl') }}+Y 仅重做一步</div>
  </div>
  <div class="set-card" v-show="match('大纲 outline 内嵌 编辑')">
    <div class="sc-head">大纲</div>
    <div class="set-row"><span>内嵌编辑</span><label class="set-toggle"><input type="checkbox" v-model="store.outlineInlineEdit" /><span class="set-toggle-slider"></span></label></div>
    <div class="set-hint">启用后，大纲节点详情面板底部显示文本编辑区</div>
  </div>
  <div class="set-card" v-show="match('光标 caret 平滑 smooth')">
    <div class="sc-head">光标</div>
    <div class="set-row"><span>平滑光标</span><label class="set-toggle"><input type="checkbox" v-model="store.smoothCaretEnabled" /><span class="set-toggle-slider"></span></label></div>
    <template v-if="store.smoothCaretEnabled">
      <div class="set-row"><span>动画时长 (ms)</span><input type="number" class="set-input set-input-sm" v-model.number="store.smoothCaretDuration" min="50" max="500" step="10" /></div>
      <div class="set-row"><span>光标样式</span><select v-model="store.smoothCaretVariant" class="set-select"><option value="line">竖线</option><option value="block">方块</option><option value="underline">下划线</option></select></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useSettingsStore } from '@worldsmith/entity-core'
import { formatKeyForDisplay } from '@worldsmith/ui-kit'
import { matchKeywords } from '../utils'

const props = defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ dirty: [] }>()

const store = useSettingsStore()

function match(keywords: string): boolean {
  return matchKeywords(props.searchQuery ?? '', keywords)
}

function onUndoLimitChange(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  if (val >= 5 && val <= 100) {
    store.undoHistoryLimit = val
    emit('dirty')
  }
}
</script>

<style scoped>
.set-card { background: var(--content-bg, var(--color-bg-surface)); border-radius: var(--radius-md); padding: 14px 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06), 0 0 0 1px var(--border, var(--color-border)); }
.sc-head { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-tertiary, var(--color-text-tertiary)); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.set-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: var(--font-size-sm); gap: 12px; }
.set-hint { font-size: var(--font-size-xs); color: var(--text-tertiary, var(--color-text-tertiary)); margin: -2px 0 4px; }

.set-toggle { position: relative; display: inline-block; width: 36px; height: 20px; cursor: pointer; flex-shrink: 0; }
.set-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
.set-toggle-slider { position: absolute; inset: 0; background: var(--border, var(--color-border)); border-radius: 20px; transition: background 0.2s; }
.set-toggle-slider::before { content: ''; position: absolute; width: 14px; height: 14px; left: 3px; top: 3px; background: var(--color-bg-surface); border-radius: 50%; transition: transform 0.2s; }
.set-toggle input:checked + .set-toggle-slider { background: var(--primary, var(--color-primary)); }
.set-toggle input:checked + .set-toggle-slider::before { transform: translateX(16px); }

.set-input { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); }
.set-input:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
.set-input-sm { width: 72px; text-align: center; }
.set-select { padding: 4px 8px; font-size: var(--font-size-sm); border: 1px solid var(--border, var(--color-border)); border-radius: var(--radius-sm); background: var(--bg, var(--color-bg-surface)); color: var(--text-color); cursor: pointer; }
.set-select:focus { outline: none; border-color: var(--primary, var(--color-primary)); }
</style>
