<script setup lang="ts">
/**
 * TuiConfirm：Tauri 端确认对话框（替代 window.confirm）
 *
 * 组件式用法：
 *   <TuiConfirm v-model:show="show" title="删除会话" message="确定删除该会话？"
 *               :danger="true" confirm-text="删除" @confirm="doDelete" />
 * 视觉与 TuiModal 一致；危险操作确认按钮用 danger 色，弱化强提示。
 * 详细why请见 docs/details/注释/tauri/components/TuiConfirm.md
 */
import TuiModal from './TuiModal.vue'
import { TuiButton } from '@worldsea/ui-kit'

const props = withDefaults(
  defineProps<{
    show: boolean
    title?: string
    message?: string
    /** 是否为危险操作（确认按钮变红） */
    danger?: boolean
    confirmText?: string
    cancelText?: string
    /** 确认按钮加载态（异步操作时禁用防重复） */
    loading?: boolean
  }>(),
  { title: '确认操作', message: '', danger: false, confirmText: '确认', cancelText: '取消', loading: false },
)

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function close() {
  emit('update:show', false)
  emit('cancel')
}
</script>

<template>
  <TuiModal
    :show="show"
    :title="title"
    size="sm"
    :mask-closable="false"
    :closable="false"
    @close="close"
  >
    <div class="tui-confirm__msg">{{ message }}</div>

    <template #footer>
      <TuiButton variant="secondary" @click="close">{{ cancelText }}</TuiButton>
      <TuiButton
        :variant="danger ? 'danger' : 'primary'"
        :loading="loading"
        @click="emit('confirm')"
      >
        {{ confirmText }}
      </TuiButton>
    </template>
  </TuiModal>
</template>

<style scoped>
.tui-confirm__msg {
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
