<template>
  <TuiModal :show="show" size="sm" :title="`批量编辑（${ids.size} 个事件）`" @close="$emit('close')">
    <div class="bem-body">
      <label class="bem-row">
        <span class="bem-label">重要程度</span>
        <select v-model="importance" class="bem-select">
          <option value="">不改动</option>
          <option v-for="item in IMPORTANCE" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="bem-row">
        <span class="bem-label">状态</span>
        <select v-model="status" class="bem-select">
          <option value="">不改动</option>
          <option v-for="item in STATUS" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <p class="bem-hint">只改选中的事件；选「不改动」的属性保持原值。</p>
    </div>
    <template #footer>
      <TuiButton variant="secondary" size="sm" @click="$emit('close')">取消</TuiButton>
      <TuiButton variant="primary" size="sm" :disabled="!dirty || saving" @click="apply">应用</TuiButton>
    </template>
  </TuiModal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { TuiButton, toastSuccess } from '@worldsea/ui-kit'
import TuiModal from '@/components/ui/TuiModal.vue'
import { applyBatchProperties } from '../composables/batchProperties'

const props = defineProps<{
  show: boolean
  /** 批量选择集（全量 id，不随分页变化） */
  ids: Set<string>
}>()

const emit = defineEmits<{
  close: []
  applied: [count: number]
}>()

const IMPORTANCE = ['关键', '重要', '普通', '细微']
const STATUS = ['正史', '废案', '备选']

const entityStore = useEntityStore()
const importance = ref('')
const status = ref('')
const saving = ref(false)
const dirty = computed(() => !!importance.value || !!status.value)

// 每次打开重置选择，避免上次的补丁误应用到新一批
watch(() => props.show, show => {
  if (show) { importance.value = ''; status.value = '' }
})

async function apply(): Promise<void> {
  if (!dirty.value || saving.value) return
  saving.value = true
  try {
    const updates = applyBatchProperties(entityStore.entities, props.ids, {
      importance: importance.value,
      status: status.value,
    })
    for (const item of updates) await entityStore.update(item.id, { properties: item.properties })
    await entityStore.loadAll()
    toastSuccess(`已更新 ${updates.length} 个事件`)
    emit('applied', updates.length)
    emit('close')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.bem-body { display: flex; flex-direction: column; gap: 12px; }
.bem-row { display: flex; align-items: center; gap: 10px; }
.bem-label { width: 72px; font-size: var(--font-size-sm); color: var(--text-secondary); }
.bem-select {
  flex: 1;
  padding: 7px 10px;
  font-size: var(--font-size-base);
  color: var(--text-color);
  background: var(--input-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  outline: none;
}
.bem-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus-ring); }
.bem-hint { margin: 0; font-size: var(--font-size-xs); color: var(--text-tertiary); }
</style>
