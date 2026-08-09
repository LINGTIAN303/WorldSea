<template>
  <div v-if="show" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal-sm">
      <h3><WsIcon name="pin" size="sm" /> 发布到侧边栏</h3>
      <p :style="'font-size:var(--font-size-sm);color:var(--color-text-secondary);margin-bottom:12px;'">
        这将注册 "{{ moduleName }}" 的所有实体类型和视图到系统中，
        侧边栏会新增对应的按钮，就像官方模块一样使用。
      </p>
      <p :style="'font-size:var(--font-size-sm);color:var(--color-text-tertiary);margin-bottom:12px;'">
        发布后仍可回来修改并重新发布，已有数据不会丢失。
      </p>
      <div class="modal-actions">
        <button class="btn-secondary" @click="$emit('close')">取消</button>
        <button class="btn-primary" @click="$emit('confirm')">确认发布</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{ show: boolean; moduleName: string }>()
defineEmits<{ close: []; confirm: [] }>()
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: var(--z-sticky); }
.modal { background: var(--bg); border-radius: var(--radius-2xl); padding: 24px; max-width: 500px; width: 90%; }
.modal-sm { max-width: 420px; }
.modal h3 { margin: 0 0 8px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.btn-primary { padding: 8px 16px; background: var(--primary); color: var(--on-accent); border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); }
.btn-secondary { padding: 8px 16px; background: var(--color-border); color: var(--text); border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); }
</style>