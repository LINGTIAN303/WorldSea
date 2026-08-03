<template>
  <Transition name="ws-scale-fade">
    <div v-if="visible" class="mm-modal-backdrop" @click.self="$emit('update:visible', false)">
      <div class="mm-modal">
        <h4>编辑标签</h4>
        <textarea :value="text" class="mm-textarea" placeholder="每行一个标签" rows="6" @input="$emit('update:text', ($event.target as HTMLTextAreaElement).value)"></textarea>
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button class="mm-btn" @click="$emit('save')">保存</button>
          <button class="mm-btn" @click="$emit('update:visible', false)">取消</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  text: string
}>()

defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'update:text', v: string): void
  (e: 'save'): void
}>()
</script>

<style scoped>
.mm-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: var(--z-overlay); display: flex; align-items: center; justify-content: center; }
.mm-modal { background: var(--card-bg); border-radius: var(--radius-xl); padding: 20px; min-width: 280px; max-width: 480px; box-shadow: var(--shadow-xl); }
.mm-modal h4 { margin-bottom: 12px; }
.mm-textarea { width: 100%; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 8px; font-size: var(--font-size-sm); resize: vertical; background: var(--bg); color: var(--text-color); }
.mm-btn { padding: 6px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: transparent; cursor: pointer; font-size: var(--font-size-sm); }
.mm-btn:hover { background: var(--hover-bg); }
</style>
