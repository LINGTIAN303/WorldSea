<template>
  <div class="group-info-panel">
    <div class="panel-header">
      <span class="panel-title">群信息</span>
      <button class="close-btn" @click="$emit('close')"><WsIcon name="x" size="xs" /></button>
    </div>

    <div class="panel-body">
      <div class="info-section">
        <div class="avatar-edit">
          <div class="group-avatar"><WsIcon name="users" size="sm" /></div>
          <input class="group-name-input" v-model="groupName" @blur="onNameChange" placeholder="群名" />
        </div>
      </div>

      <div class="info-section">
        <div class="section-label">群公告</div>
        <textarea class="announcement-input" v-model="announcement" @blur="onAnnouncementChange" placeholder="暂无公告" rows="3"></textarea>
      </div>

      <MemberList @invite="showInviteDialog = true" @private-chat="(id) => $emit('privateChat', id)" @mute-action="(id, muted, duration) => $emit('muteAction', id, muted, duration)" />

      <RequestMonitorPanel
        :get-snapshot="() => store.requestSnapshot || { records: [], perAgent: {} }"
        :get-agent-name="(id: string) => store.groupMembers.find(m => m.id === id)?.name || id"
        :on-clear-records="() => store.clearRequestSnapshot()"
      />

      <div class="sync-mode-section">
        <label class="toggle-label">
          <input type="checkbox" :checked="store.syncMode" @change="store.setSyncMode(!store.syncMode)" />
          <span>同步请求模式</span>
        </label>
        <div class="sync-mode-desc">开启后等待完整响应再显示，关闭则实时流式输出</div>
      </div>

      <div class="danger-zone">
        <button class="danger-btn" @click="$emit('dissolve')">解散群聊</button>
      </div>
    </div>

    <div v-if="showInviteDialog" class="invite-overlay">
      <div class="invite-dialog">
        <div class="invite-title">邀请成员</div>
        <input class="invite-search" v-model="inviteSearch" placeholder="搜索 Agent..." />
        <div class="invite-list">
          <div
            v-for="agent in availableAgents"
            :key="agent.id"
            class="invite-item"
            :class="{ selected: isInviteSelected(agent.id) }"
            role="checkbox"
            tabindex="0"
            :aria-checked="isInviteSelected(agent.id)"
            @click="toggleInvite(agent)"
            @keydown.enter.prevent="toggleInvite(agent)"
            @keydown.space.prevent="toggleInvite(agent)"
          >
            <div class="invite-avatar" :style="{ background: agent.color }">{{ agent.name[0] }}</div>
            <div class="invite-info">
              <span class="invite-name">{{ agent.name }}</span>
              <span class="invite-role">{{ agent.role }}</span>
            </div>
            <span v-if="isInviteSelected(agent.id)" class="invite-check">✓</span>
          </div>
          <div v-if="availableAgents.length === 0" class="invite-empty">所有 Agent 都已在群中</div>
        </div>
        <div class="invite-actions">
          <button class="invite-cancel" @click="showInviteDialog = false">取消</button>
          <button class="invite-confirm" :disabled="inviteSelected.length === 0" @click="onInviteConfirm">邀请</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGroupChatStore } from '../GroupChatStore'
import { saveCasualGroupSession } from '../GroupSessionManager'
import { useAgentRegistryStore } from '../management/AgentRegistryStore'
import type { GroupMember, BaseLayerMode, ToolSource } from '../types'
import { assignAgentColor } from '../types'
import MemberList from './MemberList.vue'
import RequestMonitorPanel from './RequestMonitorPanel.vue'
import { WsIcon } from '@worldsea/ui-kit'

defineEmits<{
  close: []
  dissolve: []
  privateChat: [memberId: string]
  muteAction: [memberId: string, muted: boolean, duration: number | null]
}>()

const store = useGroupChatStore()
const agentRegistry = useAgentRegistryStore()
const groupName = ref(store.groupInfo?.name || '')
const announcement = ref(store.groupInfo?.announcement || '')
const showInviteDialog = ref(false)
const inviteSearch = ref('')
const inviteSelected = ref<Array<{ id: string; name: string; role: string; color: string; avatar: string; systemPrompt: string; modelId?: string; enabledTools: string[]; enabledSkills: string[]; baseLayerMode?: string; customBaseLayer?: string; toolSource?: string; providerSlotId?: string }>>([])

const allAgents = computed(() => {
  return agentRegistry.agents.map(a => ({
    id: a.id,
    name: a.name,
    role: a.role,
    color: a.color,
    avatar: a.avatar,
    systemPrompt: a.systemPrompt,
    modelId: a.modelId,
    enabledTools: a.enabledTools,
    enabledSkills: a.enabledSkills,
    baseLayerMode: a.baseLayerMode,
    customBaseLayer: a.customBaseLayer,
    toolSource: a.toolSource,
    providerSlotId: a.providerSlotId,
  }))
})

const availableAgents = computed(() => {
  const memberIds = new Set(store.groupMembers.map(m => m.id))
  let agents = allAgents.value.filter(a => !memberIds.has(a.id))
  if (inviteSearch.value) {
    const q = inviteSearch.value.toLowerCase()
    agents = agents.filter(a =>
      a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q)
    )
  }
  return agents
})

function isInviteSelected(id: string): boolean {
  return inviteSelected.value.some(a => a.id === id)
}

function toggleInvite(agent: { id: string; name: string; role: string; color: string; avatar: string; systemPrompt: string; modelId?: string; enabledTools: string[]; enabledSkills: string[] }): void {
  if (isInviteSelected(agent.id)) {
    inviteSelected.value = inviteSelected.value.filter(a => a.id !== agent.id)
  } else {
    inviteSelected.value = [...inviteSelected.value, agent]
  }
}

async function onInviteConfirm(): Promise<void> {
  const now = Date.now()
  const newMembers: GroupMember[] = inviteSelected.value.map((a, i) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    color: a.color || assignAgentColor(store.groupMembers.length + i),
    avatar: a.avatar || a.name[0],
    systemPrompt: a.systemPrompt || '',
    modelId: a.modelId,
    groupRole: 'member' as const,
    joinedAt: now,
    muted: false,
    lastActiveAt: now,
    speakCount: 0,
    lastSpokeAt: 0,
    enabledTools: a.enabledTools || [],
    enabledSkills: a.enabledSkills || [],
    baseLayerMode: (a.baseLayerMode || 'empty') as BaseLayerMode,
    customBaseLayer: a.customBaseLayer,
    toolSource: (a.toolSource || 'derived') as ToolSource,
    providerSlotId: a.providerSlotId,
  }))

  store.setGroupMembers([...store.groupMembers, ...newMembers])
  inviteSelected.value = []
  showInviteDialog.value = false

  if (store.groupInfo) {
    await saveCasualGroupSession({
      info: { ...store.groupInfo, updatedAt: now },
      members: [...store.groupMembers],
      messages: [...store.casualMessages],
      desireConfig: { ...store.desireConfig },
      costTracker: { ...store.costTracker },
    })
  }
}

function onNameChange(): void {
  if (store.groupInfo && groupName.value.trim()) {
    store.setGroupInfo({ ...store.groupInfo, name: groupName.value.trim() })
    schedulePersist()
  }
}

function onAnnouncementChange(): void {
  if (store.groupInfo) {
    store.setGroupInfo({ ...store.groupInfo, announcement: announcement.value })
    schedulePersist()
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(async () => {
    if (!store.groupInfo) return
    await saveCasualGroupSession({
      info: { ...store.groupInfo, updatedAt: Date.now() },
      members: [...store.groupMembers],
      messages: [...store.casualMessages],
      desireConfig: { ...store.desireConfig },
      costTracker: { ...store.costTracker },
    })
  }, 500)
}
</script>

<style scoped>
.group-info-panel { position: absolute; right: 0; top: 0; bottom: 0; width: 320px; background: rgba(10, 10, 20, 0.08); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-left: 1px solid var(--color-border); z-index: 50; display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12); }
.panel-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--color-border); }
.panel-title { font-size: var(--fs-base); font-weight: 600; color: var(--color-text); }
.close-btn { background: none; border: none; cursor: pointer; font-size: var(--fs-lg); opacity: 0.5; color: var(--color-text-secondary); }
.close-btn:hover { opacity: 1; }
.panel-body { flex: 1; overflow-y: auto; padding: 16px; }

.info-section { margin-bottom: 16px; }
.section-label { font-size: var(--fs-xs); color: var(--color-text-tertiary); font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }

.avatar-edit { display: flex; align-items: center; gap: 12px; }
.group-avatar { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #6c5ce7, #a29bfe); display: flex; align-items: center; justify-content: center; font-size: 22px; }
.group-name-input { border: none; border-bottom: 1px solid var(--color-border); font-size: var(--fs-lg); font-weight: 600; background: transparent; outline: none; padding: 4px 0; flex: 1; color: var(--color-text); }

.announcement-input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-mid); padding: 8px; font-size: var(--fs-sm); resize: none; outline: none; background: var(--color-surface); color: var(--color-text); }
.announcement-input:focus { border-color: var(--color-primary); }

.danger-zone { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--color-border); }
.danger-btn { width: 100%; padding: 8px; border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent); border-radius: var(--radius-mid); background: color-mix(in srgb, var(--danger) 5%, transparent); color: var(--danger); cursor: pointer; font-size: var(--fs-sm); }
.danger-btn:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }

.sync-mode-section { margin-bottom: 14px; }
.sync-mode-desc { font-size: var(--fs-3xs); color: var(--color-text-tertiary); margin-top: 2px; }

.invite-overlay { position: absolute; inset: 0; background: var(--overlay); z-index: 60; display: flex; align-items: center; justify-content: center; }
.invite-dialog { background: rgba(10, 10, 20, 0.08); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border-radius: var(--radius-2xl); padding: 16px; width: 280px; max-height: 360px; display: flex; flex-direction: column; border: 1px solid var(--color-border); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); }
.invite-title { font-size: var(--fs-base); font-weight: 600; margin-bottom: 8px; text-align: center; color: var(--color-text); }
.invite-search { width: 100%; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); font-size: var(--fs-sm); background: var(--color-surface); outline: none; margin-bottom: 8px; color: var(--color-text); }
.invite-list { flex: 1; overflow-y: auto; max-height: 200px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); }
.invite-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; }
.invite-item:hover { background: var(--color-surface); }
.invite-item.selected { background: var(--color-primary-muted); }
.invite-avatar { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: var(--fs-xs); flex-shrink: 0; }
.invite-info { flex: 1; }
.invite-name { font-size: var(--fs-sm); font-weight: 600; color: var(--color-text); }
.invite-role { font-size: var(--fs-2xs); color: var(--color-text-tertiary); margin-left: 4px; }
.invite-check { color: var(--color-primary); font-weight: 700; }
.invite-empty { padding: 12px; font-size: var(--fs-xs); color: var(--color-text-tertiary); text-align: center; }
.invite-actions { display: flex; gap: 8px; margin-top: 10px; }
.invite-cancel { flex: 1; padding: 8px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); background: var(--color-surface); cursor: pointer; font-size: var(--fs-sm); color: var(--color-text-secondary); }
.invite-confirm { flex: 1; padding: 8px; border: none; border-radius: var(--radius-mid); background: var(--color-primary); color: var(--on-accent); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
.invite-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>