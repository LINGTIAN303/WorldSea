<template>
  <div class="corrector__footer">
    <button class="ft-btn" @click="emit('manual-render')">手动渲染</button>
    <span class="ft-spacer" />
    <button class="ft-btn" @click="emit('reset')">重置</button>
    <button class="ft-btn" @click="emit('save')">保存配置</button>
    <button class="ft-btn ft-btn--primary" @click="emit('export-png')">导出 {{ outputFormat.toUpperCase() }}</button>
    <button v-if="gifMode" class="ft-btn ft-btn--primary" @click="emit('export-gif')">导出 GIF</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  gifMode: boolean
  outputFormat: string
}>()

const emit = defineEmits<{
  'manual-render': []
  'reset': []
  'save': []
  'export-png': []
  'export-gif': []
}>()
</script>

<style scoped>
.corrector__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
.ft-spacer {
  flex: 1;
}
.ft-btn {
  padding: 6px 16px;
  font-size: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.ft-btn:hover {
  background: rgba(255,255,255,0.08);
}
.ft-btn--primary {
  background: var(--color-accent, #6c8cff);
  border-color: var(--color-accent, #6c8cff);
  color: #fff;
}
.ft-btn--primary:hover {
  opacity: 0.9;
}
</style>
