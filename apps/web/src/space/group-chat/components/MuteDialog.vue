<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @click.self="$emit('cancel')"></div>
    <div class="mute-dialog">
      <div class="dialog-title">禁言 {{ memberName }}</div>
      <div class="duration-options">
        <label v-for="opt in durationOptions" :key="String(opt.value)" class="duration-option" :class="{ selected: selectedDuration === opt.value }">
          <input type="radio" :value="opt.value" v-model="selectedDuration" />
          {{ opt.label }}
        </label>
      </div>
      <div class="dialog-actions">
        <button class="cancel-btn" @click="$emit('cancel')">取消</button>
        <button class="confirm-btn" @click="$emit('confirm', selectedDuration)">确认禁言</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ memberName: string }>()
defineEmits<{ cancel: []; confirm: [duration: number | null] }>()

const selectedDuration = ref<number | null>(600000)

const durationOptions = [
  { label: '10 分钟', value: 600000 },
  { label: '1 小时', value: 3600000 },
  { label: '永久禁言', value: null },
]
</script>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 10000; }
.mute-dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: 12px; padding: 20px; min-width: 280px; z-index: 10001; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.dialog-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
.duration-options { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.duration-option { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; cursor: pointer; font-size: 12px; }
.duration-option.selected { border-color: var(--color-primary); background: rgba(108,92,231,0.06); }
.dialog-actions { display: flex; gap: 8px; justify-content: flex-end; }
.cancel-btn { padding: 6px 14px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); cursor: pointer; font-size: 12px; }
.confirm-btn { padding: 6px 14px; border: none; border-radius: 8px; background: #ef4444; color: white; cursor: pointer; font-size: 12px; font-weight: 600; }
</style>
