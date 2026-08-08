<template>
  <button
    :class="['ws-button', `ws-button--${props.type}`, `ws-button--${props.size}`, { 'ws-button--block': props.block, 'ws-button--loading': props.loading, 'ws-button--disabled': props.disabled, 'ws-button--icon-only': props.iconOnly }]"
    :disabled="props.disabled || props.loading"
    :type="props.htmlType"
    :aria-busy="props.loading"
    :aria-label="props.ariaLabel"
    @click="!props.disabled && !props.loading && $emit('click', $event)"
  >
    <span v-if="props.loading" class="ws-button__spinner"></span>
    <span v-if="$slots.icon && !props.loading" class="ws-button__icon"><slot name="icon" /></span>
    <span :class="['ws-button__content', { 'ws-button__content--sr-only': props.iconOnly }]"><slot /></span>
  </button>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  type?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'text' | 'primary-gradient' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  block?: boolean
  iconOnly?: boolean
  htmlType?: 'button' | 'submit' | 'reset'
  ariaLabel?: string
}>(), {
  type: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
  block: false,
  iconOnly: false,
  htmlType: 'button',
})

defineEmits<{ click: [e: MouseEvent] }>()
</script>

<style scoped>
.ws-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  font-family: var(--font-family-base);
  font-weight: var(--button-font-weight);
  border: var(--button-border);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default), opacity var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
  position: relative;
  white-space: nowrap;
  user-select: none;
  outline: none;
  line-height: 1.4;
}
.ws-button:focus-visible {
  box-shadow: var(--shadow-focus-ring);
}

.ws-button--sm { padding: var(--button-padding-sm); font-size: var(--font-size-sm); border-radius: var(--button-radius); }
.ws-button--md { padding: var(--button-padding); font-size: var(--button-font-size); border-radius: var(--button-radius); }
.ws-button--lg { padding: var(--space-3) var(--space-5); font-size: var(--font-size-md); border-radius: var(--button-radius); }

.ws-button--primary { background: var(--button-bg); color: var(--button-color); }
.ws-button--primary:hover:not(.ws-button--disabled) { background: var(--button-bg-hover); }
.ws-button--primary:active:not(.ws-button--disabled) { background: var(--button-bg-active); transform: scale(var(--state-pressed-scale)); }

.ws-button--secondary { background: var(--button-secondary-bg); color: var(--button-secondary-color); border: 1px solid var(--button-secondary-border); }
.ws-button--secondary:hover:not(.ws-button--disabled) { background: var(--color-bg-hover); border-color: var(--color-primary); color: var(--color-primary); }
.ws-button--secondary:active:not(.ws-button--disabled) { transform: scale(var(--state-pressed-scale)); }

.ws-button--ghost { background: transparent; color: var(--button-ghost-color); border: 1px solid var(--button-ghost-border); }
.ws-button--ghost:hover:not(.ws-button--disabled) { background: var(--color-bg-hover); border-color: var(--color-primary); color: var(--color-primary); }
.ws-button--ghost:active:not(.ws-button--disabled) { transform: scale(var(--state-pressed-scale)); }

.ws-button--danger { background: var(--button-danger-bg); color: var(--button-danger-color); }
.ws-button--danger:hover:not(.ws-button--disabled) { filter: brightness(1.1); }
.ws-button--danger:active:not(.ws-button--disabled) { transform: scale(var(--state-pressed-scale)); }

.ws-button--text { background: transparent; color: var(--color-text-secondary); border: none; }
.ws-button--text:hover:not(.ws-button--disabled) { color: var(--color-primary); background: var(--color-primary-subtle); }
.ws-button--text:active:not(.ws-button--disabled) { transform: scale(var(--state-pressed-scale)); }

.ws-button--block { display: flex; width: 100%; }
.ws-button--disabled { opacity: 0.5; cursor: not-allowed; }
.ws-button--loading { cursor: wait; }

.ws-button__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ws-spin var(--duration-slow) linear infinite;
}
.ws-button__icon { display: inline-flex; align-items: center; }
.ws-button__content--sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0);
  white-space: nowrap; border: 0;
}
.ws-button--icon-only.ws-button--sm { width: 28px; height: 28px; padding: 0; }
.ws-button--icon-only.ws-button--md { width: 32px; height: 32px; padding: 0; }
.ws-button--icon-only.ws-button--lg { width: 40px; height: 40px; padding: 0; }
.ws-button--icon-only .ws-button__icon { margin: 0 auto; }

.ws-button--primary-gradient {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent, #A855F7) 100%);
  color: white;
  border: none;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.ws-button--primary-gradient:hover:not(.ws-button--disabled) { filter: brightness(1.08); }
.ws-button--primary-gradient:active:not(.ws-button--disabled) { transform: scale(var(--state-pressed-scale)); }

.ws-button--accent {
  background: var(--color-accent, #A855F7);
  color: white;
  border: none;
}
.ws-button--accent:hover:not(.ws-button--disabled) { filter: brightness(1.08); }
.ws-button--accent:active:not(.ws-button--disabled) { transform: scale(var(--state-pressed-scale)); }
</style>
