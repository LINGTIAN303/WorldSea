<script setup lang="ts">
/**
 * TuiCheckbox：Tauri 端统一复选框
 *
 * 用 v-model（modelValue）双向绑定；视觉与全局令牌一致（--accent 强调、
 * --border-strong 描边、按压回弹）。支持 label / disabled。
 * 详细why请见 docs/details/注释/tauri/components/TuiCheckbox.md
 */
import { WsIcon } from '@worldsea/ui-kit'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    label?: string
    disabled?: boolean
  }>(),
  { modelValue: false, label: '', disabled: false },
)

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

function onChange() {
  if (props.disabled) return
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <label
    class="tui-checkbox"
    :class="{ 'is-checked': modelValue, 'is-disabled': disabled }"
  >
    <input
      type="checkbox"
      class="tui-checkbox__input"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="tui-checkbox__box" aria-hidden="true">
      <WsIcon v-if="modelValue" name="check" :size="13" class="tui-checkbox__check" :stroke-width="1.7" />
    </span>
    <span v-if="label" class="tui-checkbox__label">{{ label }}</span>
  </label>
</template>

<script lang="ts">
export default { components: { WsIcon } }
</script>

<style scoped>
.tui-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: var(--fs-md);
  color: var(--text-primary);
}
.tui-checkbox.is-disabled {
  opacity: var(--disabled-opacity);
  cursor: not-allowed;
}
.tui-checkbox__input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.tui-checkbox__box {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--sf-control-edge);
  border-radius: var(--radius-sm);
  background: var(--sf-control-bg);
  color: var(--on-accent);
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
    transform var(--dur-fast) var(--ease-spring);
}
.tui-checkbox.is-checked .tui-checkbox__box {
  background: var(--accent);
  border-color: var(--accent);
}
.tui-checkbox:not(.is-disabled):hover .tui-checkbox__box {
  border-color: var(--accent);
}
.tui-checkbox:not(.is-disabled):focus-within .tui-checkbox__box {
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.tui-checkbox:not(.is-disabled):active .tui-checkbox__box {
  transform: scale(var(--sf-press-scale, var(--press-scale)));
}
.tui-checkbox__check {
  width: 14px;
  height: 14px;
}
.tui-checkbox__label {
  line-height: 1;
}
/* 减弱动态偏好：去掉按压缩放（Emil 可访问性规则） */
:root[data-anim-overlays='off'] .tui-checkbox__box {
  transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
}
:root[data-anim-overlays='off'] .tui-checkbox:not(.is-disabled):active .tui-checkbox__box {
  transform: none;
}
</style>
