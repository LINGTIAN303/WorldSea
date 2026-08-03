<template>
  <div class="ap-trash">
    <div class="ap-trash-header">
      <span class="ap-trash-count">回收站 ({{ trashedHooks.length }})</span>
      <button
        v-if="trashedHooks.length > 0"
        class="ap-trash-empty-btn"
        @click="confirmEmptyTrash"
        :class="{ confirm: emptyTrashConfirm }"
      >
        {{ emptyTrashConfirm ? '确认清空' : '清空回收站' }}
      </button>
    </div>
    <div v-if="trashLoading" class="ap-empty">加载中...</div>
    <div v-else-if="trashedHooks.length === 0" class="ap-empty">回收站为空</div>
    <div v-else class="ap-trash-list">
      <div
        v-for="hook in trashedHooks"
        :key="hook.id"
        class="ap-trash-item"
      >
        <div class="ap-trash-info">
          <div class="ap-trash-summary">{{ hook.summary || '(无摘要)' }}</div>
          <div class="ap-trash-meta">
            <span>{{ formatDate(hook.createdAt) }}</span>
            <span>{{ hook.tokenCount.toLocaleString() }} tok</span>
            <span v-if="hook.trashedAt">删除于 {{ formatDateTime(hook.trashedAt) }}</span>
          </div>
        </div>
        <div class="ap-trash-actions">
          <button class="ap-trash-restore" @click="restoreFromTrash(hook.id)" title="恢复">
            <WsIcon name="undo" size="xs" /> 恢复
          </button>
          <button class="ap-trash-perm-delete" @click="permanentDelete(hook.id)" title="永久删除">
            <WsIcon name="close" size="xs" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * TrashView - 回收回站视图
 *
 * 从 ArchivePanel.vue 拆分。自包含回收站状态和逻辑：
 * - 加载回收站列表
 * - 恢复钩子
 * - 永久删除钩子
 * - 清空回收站
 *
 * 通过 emit 'restored' 通知父组件刷新主钩子列表。
 */
import { ref, onMounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useMemoryArchive } from '../../memory-archive'
import { toastError } from '@/composables/useToast'
import { formatDate, formatDateTime } from './utils'
import type { Hook } from '@worldsmith/memory-archive'

const emit = defineEmits<{
  /** 钩子恢复或回收站清空后，通知父组件刷新主列表 */
  restored: []
}>()

const memoryArchive = useMemoryArchive()

// ===== 回收站状态 =====
const trashedHooks = ref<Hook[]>([])
const trashLoading = ref(false)
const emptyTrashConfirm = ref(false)

/** 加载回收站钩子列表 */
async function loadTrashedHooks(): Promise<void> {
  trashLoading.value = true
  try {
    trashedHooks.value = await memoryArchive.listTrashedHooks()
  } catch (err) {
    console.warn('[TrashView] 加载回收站失败:', err)
    trashedHooks.value = []
  } finally {
    trashLoading.value = false
  }
}

/** 从回收站恢复钩子 */
async function restoreFromTrash(hookId: string): Promise<void> {
  try {
    await memoryArchive.restoreHook(hookId)
    trashedHooks.value = trashedHooks.value.filter(h => h.id !== hookId)
    emit('restored')
    console.log('[TrashView] 钩子已从回收站恢复:', hookId)
  } catch (err) {
    console.warn('[TrashView] 恢复失败:', err)
    toastError('恢复钩子失败')
  }
}

/** 永久删除钩子 */
async function permanentDelete(hookId: string): Promise<void> {
  try {
    await memoryArchive.deleteHook(hookId, true) // permanent=true
    trashedHooks.value = trashedHooks.value.filter(h => h.id !== hookId)
    console.log('[TrashView] 钩子已永久删除:', hookId)
  } catch (err) {
    console.warn('[TrashView] 永久删除失败:', err)
    toastError('永久删除失败')
  }
}

/** 确认清空回收站（二次点击确认） */
function confirmEmptyTrash(): void {
  if (emptyTrashConfirm.value) {
    doEmptyTrash()
  } else {
    emptyTrashConfirm.value = true
    setTimeout(() => { emptyTrashConfirm.value = false }, 3000)
  }
}

/** 执行清空回收站 */
async function doEmptyTrash(): Promise<void> {
  try {
    const result = await memoryArchive.emptyTrash()
    trashedHooks.value = []
    emptyTrashConfirm.value = false
    emit('restored')
    console.log(`[TrashView] 回收站已清空: ${result.hooks} 钩子, ${result.files} 文件`)
  } catch (err) {
    console.warn('[TrashView] 清空回收站失败:', err)
    toastError('清空回收站失败')
  }
}

// 挂载时自动加载（v-if 切换会重新挂载，等同于原 watch subPanel==='trash' 的效果）
onMounted(loadTrashedHooks)
</script>

<style scoped>
.ap-trash {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ap-trash-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}
.ap-trash-count {
  font-size: var(--font-size-sm);
  color: var(--agent-text-secondary, #aaa);
}
.ap-trash-empty-btn {
  padding: 4px 10px;
  border: 1px solid var(--agent-danger, #e74c3c);
  background: transparent;
  color: var(--agent-danger, #e74c3c);
  border-radius: var(--agent-radius-sm, 8px);
  cursor: pointer;
  font-size: var(--font-size-xs);
}
.ap-trash-empty-btn.confirm {
  background: var(--agent-danger, #e74c3c);
  color: white;
}
.ap-trash-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ap-trash-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.2));
  border-radius: var(--agent-radius-sm, 8px);
}
.ap-trash-info {
  flex: 1;
  min-width: 0;
}
.ap-trash-summary {
  font-size: var(--font-size-xs);
  color: var(--agent-text, #e0e0e0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}
.ap-trash-meta {
  display: flex;
  gap: 8px;
  font-size: var(--text-micro-font-size);
  color: var(--agent-text-tertiary, #666);
}
.ap-trash-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.ap-trash-restore {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border: 1px solid var(--agent-border, rgba(58, 58, 106, 0.4));
  background: transparent;
  color: var(--agent-text-secondary, #aaa);
  border-radius: var(--agent-radius-sm, 6px);
  cursor: pointer;
  font-size: var(--text-micro-font-size);
}
.ap-trash-restore:hover {
  background: var(--agent-accent-bg, rgba(108, 92, 231, 0.15));
}
.ap-trash-perm-delete {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  border: 1px solid var(--agent-danger, #e74c3c);
  background: transparent;
  color: var(--agent-danger, #e74c3c);
  border-radius: var(--agent-radius-sm, 6px);
  cursor: pointer;
}
.ap-trash-perm-delete:hover {
  background: rgba(231, 76, 60, 0.15);
}
.ap-empty {
  padding: 24px;
  text-align: center;
  color: var(--agent-text-secondary, #888);
  font-size: var(--font-size-sm);
}
</style>
