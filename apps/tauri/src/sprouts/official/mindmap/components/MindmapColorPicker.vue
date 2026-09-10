<template>
  <Transition name="ws-scale-fade">
    <div v-if="visible" class="mm-modal-backdrop" @click.self="$emit('update:visible', false)">
      <div class="mm-modal">
        <h4>选择颜色</h4>
        <div class="mm-color-grid">
          <button v-for="c in presetColors" :key="c" class="mm-color-btn" :style="{ background: c }" :aria-label="`选择颜色 ${c}`" @click="$emit('pick', c)"></button>
        </div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
          <input :value="customColor" type="color" class="mm-color-input" aria-label="自定义颜色" @input="$emit('update:customColor', ($event.target as HTMLInputElement).value)" />
          <button class="mm-btn" @click="$emit('pick', customColor)">自定义</button>
          <button class="mm-btn" @click="$emit('pick', '')">清除</button>
          <button class="mm-btn" @click="$emit('update:visible', false)">取消</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  customColor: string
  presetColors: string[]
}>()

defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'update:customColor', v: string): void
  (e: 'pick', color: string): void
}>()
</script>

<style scoped>
.mm-modal-backdrop { position: fixed; inset: 0; background: var(--overlay); z-index: var(--z-overlay); display: flex; align-items: center; justify-content: center; }
.mm-modal { background: var(--card-bg); border-radius: var(--radius-xl); padding: 20px; min-width: 280px; max-width: 480px; box-shadow: var(--shadow-xl); }
.mm-modal h4 { margin-bottom: 12px; }
.mm-color-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.mm-color-btn { width: 36px; height: 36px; border-radius: var(--radius-sm); border: 2px solid var(--border-color); cursor: pointer; }
.mm-color-input { width: 36px; height: 36px; border: none; cursor: pointer; padding: 0; border-radius: var(--radius-sm); }
.mm-btn { padding: 6px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: transparent; cursor: pointer; font-size: var(--font-size-sm); }
.mm-btn:hover { background: var(--hover-bg); }
</style>
