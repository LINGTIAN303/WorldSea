<template>
  <Teleport to="body">
    <div v-for="pos in positions" :key="pos" :class="['cn-zone', `cn-zone-${pos}`]">
      <TransitionGroup name="ws-list" tag="div" class="cn-stack">
        <div
          v-for="n in notificationsByPosition(pos)"
          :key="n.id"
          class="cn-card"
          :class="{
            'cn-farewell': n.isFarewell,
            'cn-pinned': n.pinned,
          }"
          @click="onCardClick(n)"
        >
          <div class="cn-header">
            <WsIcon class="cn-avatar" :name="typeIcon(n.entityType)" size="sm" />
            <span class="cn-name">{{ n.entityName }}</span>
            <WsIcon v-if="n.pinned" class="cn-pin-badge" name="pin" size="xs" />
            <button class="cn-close" @click.stop="onClose(n.id)">✕</button>
          </div>
          <div class="cn-content">{{ n.content }}</div>
          <template v-if="n.pinned">
            <div v-if="getHistory(n.entityId).length > 1" class="cn-history">
              <div class="cn-history-title">历史消息</div>
              <div
                v-for="(msg, idx) in getHistory(n.entityId).slice(0, 5)"
                :key="idx"
                class="cn-history-item"
              >
                · {{ msg }}
              </div>
            </div>
          </template>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { CompanionNotificationData } from '@worldsmith/shared-composables/companion/useCompanionMode'
import type { PopupPosition } from '@worldsmith/shared-composables/companion/scene'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  notifications: CompanionNotificationData[]
  sessionMemory?: Map<string, string[]>
}>()

const emit = defineEmits<{
  dismiss: [id: string]
  pin: [id: string]
  unpin: [id: string]
}>()

const positions: PopupPosition[] = ['top-right', 'bottom-right', 'bottom-left', 'top-center']

function notificationsByPosition(pos: PopupPosition) {
  return props.notifications.filter(n => (n.position || 'top-right') === pos)
}

function typeIcon(type: string): string {
  const map: Record<string, string> = {
    character: 'character',
    region: 'location',
    event: 'timeline',
    item: 'item',
    organization: 'war',
    concept: 'inspiration',
  }
  return map[type] || 'edit'
}

function onCardClick(n: CompanionNotificationData) {
  if (n.pinned) return
  emit('pin', n.id)
}

function onClose(id: string) {
  emit('dismiss', id)
}

function getHistory(entityId: string): string[] {
  return props.sessionMemory?.get(entityId) || []
}
</script>

<style scoped>
.cn-zone {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  max-width: 320px;
}

.cn-zone-top-right {
  top: 16px;
  right: 16px;
}

.cn-zone-bottom-right {
  bottom: 16px;
  right: 16px;
}

.cn-zone-bottom-left {
  bottom: 16px;
  left: 16px;
}

.cn-zone-top-center {
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
}

.cn-stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cn-zone-bottom-right .cn-stack,
.cn-zone-bottom-left .cn-stack {
  flex-direction: column-reverse;
}

.cn-card {
  pointer-events: auto;
  background: var(--content-bg, #fff);
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--border, rgba(0, 0, 0, 0.06));
  transition: background 0.3s ease, border-color 0.3s ease, color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease, opacity 0.3s ease, filter 0.3s ease;
  cursor: pointer;
}

.cn-card:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16), 0 0 0 1px var(--border, rgba(0, 0, 0, 0.1));
}

.cn-pinned {
  max-width: 360px;
  border-left: 3px solid var(--accent, #6366f1);
  cursor: default;
}

.cn-farewell {
  opacity: 0.8;
  background: var(--bg-secondary, #f9fafb);
}

.cn-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.cn-avatar {
  font-size: var(--font-size-xl);
  line-height: 1;
}

.cn-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cn-pin-badge {
  font-size: var(--font-size-sm);
  line-height: 1;
}

.cn-close {
  background: none;
  border: none;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary, #999);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  flex-shrink: 0;
}

.cn-close:hover {
  background: var(--hover-bg, #f3f4f6);
  color: var(--text-color);
}

.cn-content {
  font-size: var(--font-size-sm);
  color: var(--text-color);
  line-height: 1.5;
  word-break: break-word;
}

.cn-history {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border, rgba(0, 0, 0, 0.06));
}

.cn-history-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-tertiary, #999);
  margin-bottom: 4px;
}

.cn-history-item {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.4;
  padding: 2px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
