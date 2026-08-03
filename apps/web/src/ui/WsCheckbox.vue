<template>
  <label :class="['ws-checkbox', { 'ws-checkbox--checked': modelValue, 'ws-checkbox--disabled': disabled }]">
    <input type="checkbox" class="ws-checkbox__input" :checked="modelValue" :disabled="disabled" @change="onChange" />
    <span class="ws-checkbox__box">
      <svg v-if="modelValue" class="ws-checkbox__check" viewBox="0 0 16 16" fill="none">
        <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
    <span v-if="label" class="ws-checkbox__label">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  modelValue?: boolean
  label?: string
  disabled?: boolean
}>(), {
  modelValue: false,
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function onChange() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<style scoped>
.ws-checkbox {
  display: inline-flex; align-items: center; gap: var(--space-2);
  cursor: pointer; user-select: none; font-size: var(--font-size-base);
  color: var(--color-text-primary);
}
.ws-checkbox--disabled { opacity: 0.5; cursor: not-allowed; }

.ws-checkbox__input { position: absolute; opacity: 0; width: 0; height: 0; }

.ws-checkbox__box {
  width: 18px; height: 18px; border: 2px solid var(--color-border-strong);
  border-radius: var(--radius-xs); display: flex; align-items: center; justify-content: center;
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default); flex-shrink: 0;
}
.ws-checkbox--checked .ws-checkbox__box {
  background: var(--color-primary); border-color: var(--color-primary); color: #fff;
}
.ws-checkbox:not(.ws-checkbox--disabled):hover .ws-checkbox__box { border-color: var(--color-primary); }
.ws-checkbox:not(.ws-checkbox--disabled):focus-within .ws-checkbox__box { box-shadow: var(--shadow-focus-ring); }
.ws-checkbox__check { width: 14px; height: 14px; }
.ws-checkbox__label { line-height: 1; }
</style>
