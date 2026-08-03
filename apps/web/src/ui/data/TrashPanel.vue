<template>
  <Teleport to="body">
    <div class="trash-overlay" v-if="show" @click.self="close">
      <div class="trash-modal">
        <div class="trash-header">
          <h3>回收站</h3>
          <div class="trash-hdr-actions">
            <span class="trash-count">{{ trashStore.totalCount }} 项</span>
            <button class="trash-close" @click="close">✕</button>
          </div>
        </div>

        <div class="trash-toolbar" v-if="trashStore.totalCount > 0">
          <button class="btn btn-danger" @click="confirmEmptyTrash">清空回收站</button>
        </div>

        <div class="trash-list">
          <div v-for="item in trashStore.entityItems" :key="item.id" class="trash-item">
            <div class="trash-item-info">
              <span class="trash-item-name">{{ (item.data as any).name }}</span>
              <span class="trash-item-type">{{ (item.data as any).type }}</span>
              <span class="trash-item-date">{{ formatDate(item.deletedAt) }}</span>
            </div>
            <div class="trash-item-actions">
              <button class="btn btn-sm" @click="doRestore(item.id)">恢复</button>
              <button class="btn btn-sm btn-danger" @click="doPermanentDelete(item.id)">永久删除</button>
            </div>
          </div>

          <div v-if="trashStore.totalCount === 0" class="trash-empty">
            回收站为空
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useTrashStore } from '@worldsmith/entity-core'
import { useTrash } from '@worldsmith/entity-core'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const trashStore = useTrashStore()
const { restoreEntity, permanentDeleteEntity } = useTrash()

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function doRestore(trashItemId: string) {
  const ok = await restoreEntity(trashItemId)
  if (ok) {
    // 恢复成功后刷新数据
    const { useEntityStore, useRelationStore } = await import('@worldsmith/entity-core')
    await useEntityStore().loadAll()
    await useRelationStore().loadAll()
  }
}

function doPermanentDelete(trashItemId: string) {
  if (confirm('永久删除后无法恢复，确定？')) {
    permanentDeleteEntity(trashItemId)
  }
}

function confirmEmptyTrash() {
  if (confirm('清空回收站后所有项目将永久删除，确定？')) {
    trashStore.emptyTrash()
  }
}

function close() {
  emit('close')
}
</script>

<style scoped>
.trash-overlay { position: fixed; inset: 0; z-index: var(--z-overlay); background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.trash-modal { width: 500px; max-height: 70vh; background: var(--content-bg); border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); display: flex; flex-direction: column; overflow: hidden; }
.trash-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.trash-header h3 { margin: 0; font-size: var(--font-size-lg); }
.trash-hdr-actions { display: flex; align-items: center; gap: 12px; }
.trash-count { font-size: var(--font-size-sm); color: var(--text-secondary); }
.trash-close { background: none; border: none; font-size: var(--font-size-xl); cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.trash-close:hover { background: var(--hover-bg); }
.trash-toolbar { padding: 8px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: flex-end; }
.trash-list { flex: 1; overflow-y: auto; }
.trash-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; border-bottom: 1px solid var(--border); }
.trash-item:hover { background: var(--hover-bg); }
.trash-item-info { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.trash-item-name { font-weight: var(--font-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trash-item-type { font-size: var(--font-size-xs); color: var(--text-tertiary); background: var(--bg); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.trash-item-date { font-size: var(--font-size-xs); color: var(--text-tertiary); flex-shrink: 0; }
.trash-item-actions { display: flex; gap: 6px; flex-shrink: 0; margin-left: 12px; }
.trash-empty { text-align: center; padding: 40px; color: var(--text-tertiary); }
.btn { padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); cursor: pointer; font-size: var(--font-size-sm); }
.btn:hover { background: var(--bg-hover); }
.btn.btn-sm { padding: 3px 8px; font-size: var(--font-size-xs); }
.btn.btn-danger { color: var(--danger); border-color: var(--danger); }
.btn.btn-danger:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }
</style>
