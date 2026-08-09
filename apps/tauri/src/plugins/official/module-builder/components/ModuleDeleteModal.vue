<template>
  <div v-if="show" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal modal-sm">
      <h3 style="color:var(--danger);"><WsIcon name="warning" size="sm" /> 确认删除</h3>
      <p style="font-size:var(--font-size-base);margin:12px 0;">
        确定要删除模块 <strong>"{{ moduleName }}"</strong> 吗？
      </p>
      <p style="font-size:var(--font-size-sm);color:var(--text-tertiary);">
        · 侧边栏中对应的视图仍会存在，但数据条目将保留在数据库中<br/>
        · 如需完全清理，请手动删除各条目
      </p>
      <div class="modal-actions">
        <button class="btn-secondary" @click="$emit('close')">取消</button>
        <button class="btn-danger" @click="$emit('confirm')">确认删除</button>
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
.btn-secondary { padding: 8px 16px; background: var(--border-color); color: var(--text); border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); }
.btn-danger { padding: 8px 16px; background: var(--color-danger); color: var(--color-text-inverse); border: none; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); }
</style>