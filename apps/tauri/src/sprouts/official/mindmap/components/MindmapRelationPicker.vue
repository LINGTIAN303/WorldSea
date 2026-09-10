<template>
  <Transition name="ws-scale-fade">
    <div v-if="visible" class="mm-modal-backdrop" @click.self="$emit('update:visible', false)">
      <div class="mm-modal">
        <h4>选择关系类型</h4>
        <div class="mm-modal-grid">
          <button v-for="rt in relationTypes" :key="rt.type" class="mm-type-card" @click="$emit('pick', rt)">
            <span>{{ rt.label }}</span>
          </button>
        </div>
        <button class="mm-btn" @click="$emit('update:visible', false)">取消</button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  relationTypes: { type: string; label: string }[]
}>()

defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'pick', rt: { type: string; label: string }): void
}>()
</script>

<style scoped>
.mm-modal-backdrop { position: fixed; inset: 0; background: var(--overlay); z-index: var(--z-overlay); display: flex; align-items: center; justify-content: center; }
.mm-modal { background: var(--card-bg); border-radius: var(--radius-xl); padding: 20px; min-width: 280px; max-width: 480px; box-shadow: var(--shadow-xl); }
.mm-modal h4 { margin-bottom: 12px; }
.mm-modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 8px; margin-bottom: 12px; }
.mm-type-card { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: none; cursor: pointer; font-size: var(--font-size-sm); transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast), filter var(--transition-fast); }
.mm-type-card:hover { border-color: var(--primary); background: var(--primary-light); }
.mm-btn { padding: 6px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: transparent; cursor: pointer; font-size: var(--font-size-sm); }
.mm-btn:hover { background: var(--hover-bg); }
</style>
