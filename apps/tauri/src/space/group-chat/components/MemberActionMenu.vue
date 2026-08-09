<template>
  <Teleport to="body">
    <div class="menu-backdrop" @click.self="$emit('close')"></div>
    <div class="member-action-menu" :style="menuStyle">
      <div class="menu-header">
        <div class="menu-avatar" :style="{ background: member.color }">{{ member.name[0] }}</div>
        <span class="menu-name">{{ member.name }}</span>
      </div>
      <div class="menu-actions">
        <button class="menu-item" @click="$emit('privateChat', member.id)"><WsIcon name="chat" size="xs" /> 私聊</button>
        <button v-if="member.groupRole === 'member'" class="menu-item" @click="$emit('setAdmin', member.id)">设为管理员</button>
        <button v-if="member.groupRole === 'admin'" class="menu-item" @click="$emit('setAdmin', member.id)">取消管理员</button>
        <button class="menu-item" @click="$emit('mute', member.id)">
          <WsIcon :name="member.muted ? 'volume-on' : 'volume-off'" size="xs" />
          {{ member.muted ? '解除禁言' : '禁言' }}
        </button>
        <button class="menu-item danger" @click="$emit('kick', member.id)">移出群聊</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GroupMember } from '../types'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{ member: GroupMember; anchorRect?: DOMRect | null }>()
defineEmits<{ close: []; privateChat: [memberId: string]; setAdmin: [memberId: string]; mute: [memberId: string]; kick: [memberId: string] }>()

const menuStyle = computed(() => {
  if (props.anchorRect) {
    const rect = props.anchorRect
    // 菜单定位在成员项右侧，垂直居中对齐
    const left = rect.right + 6
    const top = rect.top + rect.height / 2 - 80 // 大致居中
    // 边界检测：如果右侧放不下，放到左侧
    const adjustedLeft = left + 200 > window.innerWidth ? rect.left - 206 : left
    const adjustedTop = Math.max(8, Math.min(top, window.innerHeight - 200))
    return {
      position: 'fixed' as const,
      left: `${adjustedLeft}px`,
      top: `${adjustedTop}px`,
      transform: 'none',
    }
  }
  return {
    position: 'fixed' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  }
})
</script>

<style scoped>
.menu-backdrop { position: fixed; inset: 0; z-index: 9998; }
.member-action-menu { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: 12px; padding: 4px; min-width: 200px; z-index: 9999; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.menu-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--color-border); margin-bottom: 4px; }
.menu-avatar { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: var(--fs-xs); }
.menu-name { font-weight: 600; font-size: var(--fs-md); }
.menu-actions { display: flex; flex-direction: column; }
.menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--fs-sm); text-align: left; width: 100%; color: var(--color-text); }
.menu-item:hover { background: var(--color-surface); }
.menu-item.danger { color: var(--color-danger); }
.menu-item.danger:hover { background: var(--color-danger-subtle, rgba(239,68,68,0.08)); }
</style>