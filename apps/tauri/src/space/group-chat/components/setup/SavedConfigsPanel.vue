<template>
  <div>
    <div v-if="configs.length === 0" class="empty-hint">尚未保存任何配置，调整好参与者后点击保存</div>
    <div v-else class="saved-list">
      <div
        v-for="cfg in configs"
        :key="cfg.id"
        class="saved-card"
        :class="{ active: activeId === cfg.id }"
        @click="$emit('apply', cfg.id)"
      >
        <div class="saved-main">
          <div v-if="renamingId === cfg.id" class="rename-row" @click.stop>
            <input
              ref="renameInputRef"
              v-model="renameValue"
              class="rename-input"
              @keydown.enter="confirmRename(cfg.id)"
              @keydown.escape="cancelRename"
              @blur="confirmRename(cfg.id)"
            />
          </div>
          <div v-else class="saved-info">
            <div class="saved-name">{{ cfg.name }}</div>
            <div class="saved-meta">{{ cfg.participants.length }} 人 · {{ cfg.maxRounds }} 轮</div>
          </div>
        </div>
        <div class="saved-actions" @click.stop>
          <button class="sa-btn" title="重命名" @click="startRename(cfg.id, cfg.name)"><WsIcon name="pencil" size="xs" /></button>
          <button class="sa-btn" title="删除" @click="$emit('delete', cfg.id)"><WsIcon name="trash" size="xs" /></button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { SavedGroupConfig } from './types'

defineProps<{
  configs: SavedGroupConfig[]
  activeId: string | null
}>()

const emit = defineEmits<{
  apply: [id: string]
  delete: [id: string]
  rename: [id: string, newName: string]
}>()

/** 重命名相关状态仅在面板内部使用，确认后通过 emit 通知父组件持久化 */
const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

function startRename(id: string, currentName: string): void {
  renamingId.value = id
  renameValue.value = currentName
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

function confirmRename(id: string): void {
  if (renamingId.value !== id) return
  const trimmed = renameValue.value.trim()
  if (trimmed) {
    emit('rename', id, trimmed)
  }
  renamingId.value = null
  renameValue.value = ''
}

function cancelRename(): void {
  renamingId.value = null
  renameValue.value = ''
}
</script>

<style scoped>
.empty-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  padding: 8px 0;
  text-align: center;
}

.saved-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.saved-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.saved-card:hover {
  border-color: var(--color-primary);
  background: rgba(108, 92, 231, 0.03);
}

.saved-card.active {
  border-color: var(--color-primary);
  background: rgba(108, 92, 231, 0.07);
}

.saved-main {
  flex: 1;
  min-width: 0;
}

.saved-info {
  min-width: 0;
}

.saved-name {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.saved-meta {
  font-size: 10px;
  color: var(--color-text-tertiary);
  margin-top: 1px;
}

.rename-row {
  display: flex;
  align-items: center;
}

.rename-input {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  background: var(--color-surface-elevated);
  color: var(--color-text);
  outline: none;
}

.saved-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  margin-left: 8px;
}

.sa-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0.5;
  transition: opacity 0.15s;
}

.sa-btn:hover {
  opacity: 1;
}
</style>