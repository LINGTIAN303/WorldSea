<template>
  <div class="member-list">
    <div class="list-header">
      <span class="section-label">成员 ({{ store.groupMembers.length }})</span>
      <button class="invite-btn" @click="$emit('invite')"><WsIcon name="plus" size="xs" /> 邀请</button>
    </div>
    <div class="members">
      <div v-for="member in store.groupMembers" :key="member.id" class="member-item" @click="onMemberClick($event, member)">
        <div class="member-avatar" :style="{ background: member.color }">
          <span class="avatar-letter">{{ member.name[0] }}</span>
        </div>
        <div class="member-info">
          <div class="member-name-row">
            <span class="member-name">{{ member.name }}</span>
            <span v-if="member.groupRole === 'owner'" class="role-tag owner-tag"><WsIcon name="crown" size="xs" /> 群主</span>
            <span v-else-if="member.groupRole === 'admin'" class="role-tag admin-tag"><WsIcon name="shield" size="xs" /> 管理员</span>
            <WsIcon v-if="member.muted" name="volume-off" size="xs" class="mute-icon" />
          </div>
          <div class="member-role-text">{{ member.role }}</div>
        </div>
      </div>
    </div>

    <MemberActionMenu
      v-if="selectedMember"
      :member="selectedMember"
      :anchor-rect="menuAnchorRect"
      @close="selectedMember = null; menuAnchorRect = null"
      @private-chat="onPrivateChat"
      @set-admin="onSetAdmin"
      @mute="onMuteRequest"
      @kick="onKick"
    />

    <MuteDialog
      v-if="muteTarget"
      :member-name="muteTarget.name"
      @cancel="muteTarget = null"
      @confirm="onMuteConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useGroupChatStore } from '../GroupChatStore'
import { saveCasualGroupSession } from '../GroupSessionManager'
import type { GroupMember } from '../types'
import MemberActionMenu from './MemberActionMenu.vue'
import MuteDialog from './MuteDialog.vue'
import { WsIcon } from '@worldsmith/ui-kit'

const emit = defineEmits<{
  invite: []
  privateChat: [memberId: string]
  muteAction: [memberId: string, muted: boolean, duration: number | null]
}>()

const store = useGroupChatStore()
const selectedMember = ref<GroupMember | null>(null)
const menuAnchorRect = ref<DOMRect | null>(null)
const muteTarget = ref<GroupMember | null>(null)

function onMemberClick(event: MouseEvent, member: GroupMember): void {
  selectedMember.value = member
  menuAnchorRect.value = (event.currentTarget as HTMLElement).getBoundingClientRect()
}

function onPrivateChat(memberId: string): void {
  selectedMember.value = null
  emit('privateChat', memberId)
}

async function onSetAdmin(memberId: string): Promise<void> {
  const member = store.groupMembers.find(m => m.id === memberId)
  if (!member) { selectedMember.value = null; return }
  const newRole = member.groupRole === 'admin' ? 'member' as const : 'admin' as const
  store.updateGroupMember(memberId, { groupRole: newRole })
  selectedMember.value = null
  await persistMembers()
}

function onMuteRequest(memberId: string): void {
  const member = store.groupMembers.find(m => m.id === memberId)
  if (!member) { selectedMember.value = null; return }
  selectedMember.value = null
  if (member.muted) {
    // 已禁言则直接解禁
    store.updateGroupMember(memberId, { muted: false, mutedUntil: undefined })
    emit('muteAction', memberId, false, null)
    persistMembers()
  } else {
    // 未禁言则打开时长选择弹窗
    muteTarget.value = member
  }
}

async function onMuteConfirm(duration: number | null): Promise<void> {
  if (!muteTarget.value) return
  const memberId = muteTarget.value.id
  const mutedUntil = duration ? Date.now() + duration : undefined
  store.updateGroupMember(memberId, { muted: true, mutedUntil })
  emit('muteAction', memberId, true, duration)
  muteTarget.value = null
  await persistMembers()
}

async function onKick(memberId: string): Promise<void> {
  store.setGroupMembers(store.groupMembers.filter(m => m.id !== memberId))
  selectedMember.value = null
  await persistMembers()
}

async function persistMembers(): Promise<void> {
  if (!store.groupInfo) return
  await saveCasualGroupSession({
    info: { ...store.groupInfo, updatedAt: Date.now() },
    members: [...store.groupMembers],
    messages: [...store.casualMessages],
    desireConfig: { ...store.desireConfig },
    costTracker: { ...store.costTracker },
  })
}
</script>

<style scoped>
.member-list {}
.list-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-label { font-size: var(--fs-xs); color: var(--color-text-tertiary); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.invite-btn { padding: 4px 10px; border: 1px solid var(--color-primary); border-radius: var(--radius-sm); background: transparent; color: var(--color-primary); cursor: pointer; font-size: var(--fs-xs); font-weight: 600; }
.invite-btn:hover { background: rgba(108,92,231,0.08); }

.members { display: flex; flex-direction: column; gap: 2px; }
.member-item { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: var(--radius-sm); cursor: pointer; }
.member-item:hover { background: var(--color-surface); }
.member-avatar { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.avatar-letter { color: white; font-weight: 700; font-size: var(--fs-sm); }
.member-info { flex: 1; min-width: 0; }
.member-name-row { display: flex; align-items: center; gap: 4px; }
.member-name { font-size: var(--fs-sm); font-weight: 600; }
.role-tag { font-size: var(--fs-3xs); padding: 1px 4px; border-radius: var(--radius-2xs); font-weight: 600; display: inline-flex; align-items: center; gap: 2px; }
.owner-tag { background: rgba(245,158,11,0.15); color: #f59e0b; }
.admin-tag { background: rgba(59,130,246,0.15); color: #3b82f6; }
.mute-icon { color: var(--color-text-tertiary); }
.member-role-text { font-size: var(--fs-2xs); color: var(--color-text-tertiary); }
</style>