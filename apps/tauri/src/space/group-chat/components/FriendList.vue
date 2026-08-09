<template>
  <div class="friend-list">
    <div class="list-header">
      <input class="search-input" v-model="searchQuery" placeholder="搜索好友..." />
      <button class="close-btn" @click="$emit('close')" title="关闭"><WsIcon name="x" size="xs" /></button>
    </div>

    <div class="friend-body">
      <div
        v-for="agent in filteredAgents"
        :key="agent.id"
        class="friend-item"
        @click="$emit('private-chat', agent)"
        @contextmenu.prevent="onContextMenu($event, agent)"
      >
        <div class="friend-avatar" :style="{ background: agent.color }">{{ agent.avatar }}</div>
        <div class="friend-info">
          <span class="friend-name">{{ agent.name }}</span>
          <span class="friend-role">{{ agent.role }}</span>
        </div>
        <span class="friend-source"><WsIcon :name="agent.sourceType === 'entity' ? 'landmark' : 'pencil'" size="xs" /></span>
      </div>
      <div v-if="filteredAgents.length === 0" class="friend-empty">
        {{ searchQuery ? '未找到匹配的好友' : '暂无好友，在顶栏 Agent 管理中创建' }}
      </div>
    </div>

    <div v-if="contextMenu.visible" class="context-menu" :style="contextMenuStyle" @click.stop>
      <div class="context-menu-item" @click="onAddToGroup">添加到当前群聊</div>
      <div class="context-menu-item danger" @click="onDeleteFriend">删除好友</div>
    </div>

    <div v-if="deleteConfirmId" class="delete-confirm-overlay" @click.self="deleteConfirmId = null">
      <div class="delete-confirm-dialog">
        <div class="delete-confirm-text">确定删除此好友？已有群中的成员不受影响。</div>
        <div class="delete-confirm-actions">
          <button class="delete-cancel-btn" @click="deleteConfirmId = null">取消</button>
          <button class="delete-confirm-btn" @click="confirmDelete">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useAgentRegistryStore } from '../management/AgentRegistryStore'
import { useGroupChatStore } from '../GroupChatStore'
import { saveCasualGroupSession } from '../GroupSessionManager'
import { assignAgentColor } from '../types'
import type { ChatAgent, GroupMember } from '../types'
import { WsIcon } from '@worldsmith/ui-kit'

const emit = defineEmits<{
  close: []
  'private-chat': [agent: ChatAgent]
}>()

const agentRegistry = useAgentRegistryStore()
const groupChatStore = useGroupChatStore()
const searchQuery = ref('')

interface FriendContextMenu {
  visible: boolean
  agent: ChatAgent | null
  x: number
  y: number
}

const contextMenu = ref<FriendContextMenu>({ visible: false, agent: null, x: 0, y: 0 })
const deleteConfirmId = ref<string | null>(null)

const contextMenuStyle = computed(() => ({
  position: 'fixed' as const,
  left: `${contextMenu.value.x}px`,
  top: `${contextMenu.value.y}px`,
  zIndex: 10000,
}))

const filteredAgents = computed(() => {
  let list = agentRegistry.agents
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(a => a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q))
  }
  return list
})

function onContextMenu(event: MouseEvent, agent: ChatAgent): void {
  const menuWidth = 180
  const menuHeight = 80
  contextMenu.value = {
    visible: true,
    agent,
    x: Math.min(event.clientX, window.innerWidth - menuWidth),
    y: Math.min(event.clientY, window.innerHeight - menuHeight),
  }
}

function closeContextMenu(): void {
  contextMenu.value.visible = false
  contextMenu.value.agent = null
}

async function onAddToGroup(): Promise<void> {
  const agent = contextMenu.value.agent
  closeContextMenu()
  if (!agent) return

  const memberIds = new Set(groupChatStore.groupMembers.map(m => m.id))
  if (memberIds.has(agent.id)) return

  const now = Date.now()
  const newMember: GroupMember = {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    color: agent.color || assignAgentColor(groupChatStore.groupMembers.length),
    avatar: agent.avatar || agent.name[0],
    systemPrompt: agent.systemPrompt || '',
    modelId: agent.modelId,
    groupRole: 'member' as const,
    joinedAt: now,
    muted: false,
    lastActiveAt: now,
    speakCount: 0,
    lastSpokeAt: 0,
    enabledTools: agent.enabledTools || [],
    enabledSkills: agent.enabledSkills || [],
    baseLayerMode: agent.baseLayerMode || 'empty',
    customBaseLayer: agent.customBaseLayer,
    toolSource: agent.toolSource || 'derived',
  }

  groupChatStore.setGroupMembers([...groupChatStore.groupMembers, newMember])

  if (groupChatStore.groupInfo) {
    await saveCasualGroupSession({
      info: { ...groupChatStore.groupInfo, updatedAt: now },
      members: [...groupChatStore.groupMembers],
      messages: [...groupChatStore.casualMessages],
      desireConfig: { ...groupChatStore.desireConfig },
      costTracker: { ...groupChatStore.costTracker },
    })
  }
}

function onDeleteFriend(): void {
  const agent = contextMenu.value.agent
  closeContextMenu()
  if (agent) {
    deleteConfirmId.value = agent.id
  }
}

async function confirmDelete(): Promise<void> {
  if (deleteConfirmId.value) {
    await agentRegistry.deleteAgentAndPersist(deleteConfirmId.value)
    deleteConfirmId.value = null
  }
}

function onDocumentClick(event: MouseEvent): void {
  if (!contextMenu.value.visible) return
  const target = event.target as HTMLElement | null
  if (target && target.closest('.context-menu')) return
  closeContextMenu()
}

onMounted(async () => {
  await agentRegistry.loadFromDB()
  document.addEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
})
</script>

<style scoped>
.friend-list { display: flex; flex-direction: column; height: 100%; contain: layout paint style; }

.list-header { padding: 8px; display: flex; gap: 6px; }
.search-input { flex: 1; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); font-size: var(--fs-sm); background: var(--color-surface); outline: none; color: var(--color-text); }
.search-input:focus { border-color: var(--color-primary); }
.close-btn { width: 24px; height: 24px; border: none; background: transparent; border-radius: var(--radius-xs); cursor: pointer; font-size: var(--fs-sm); color: var(--color-text-tertiary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.close-btn:hover { background: var(--color-surface-elevated); color: var(--color-text); }

.friend-body { flex: 1; overflow-y: auto; min-height: 0; contain: layout paint style; }

.friend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  position: relative;
  transition: background 0.2s ease, border-left-color 0.25s ease, transform 0.2s ease;
}
.friend-item::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0 6px 6px 0;
  background: var(--color-primary);
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}
.friend-item:hover {
  background: var(--color-surface);
  border-left-color: rgba(108,92,231,0.3);
  transform: translateX(2px);
}
.friend-item:hover::after {
  opacity: 0.04;
}

.friend-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--on-accent);
  font-weight: 700;
  font-size: var(--fs-md);
  flex-shrink: 0;
}

.friend-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.friend-name { font-size: var(--fs-md); font-weight: 600; color: var(--color-text); }
.friend-role { font-size: var(--fs-xs); color: var(--color-text-tertiary); }
.friend-source { font-size: 10px; color: var(--color-text-tertiary); }

.friend-empty {
  padding: 24px 12px;
  font-size: var(--fs-sm);
  color: var(--color-text-tertiary);
  text-align: center;
  line-height: 1.6;
}

.context-menu {
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 4px;
  min-width: 160px;
}
.context-menu-item { padding: 8px 12px; font-size: var(--fs-sm); color: var(--color-text); cursor: pointer; border-radius: var(--radius-sm); transition: background 0.1s; }
.context-menu-item:hover { background: var(--color-surface); }
.context-menu-item.danger { color: var(--danger); }
.context-menu-item.danger:hover { background: rgba(239, 68, 68, 0.1); }

.delete-confirm-overlay { position: fixed; inset: 0; background: var(--overlay); z-index: var(--z-modal); display: flex; align-items: center; justify-content: center; }
.delete-confirm-dialog { background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-2xl); padding: 20px; min-width: 260px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.delete-confirm-text { font-size: var(--fs-md); margin-bottom: 16px; line-height: 1.5; }
.delete-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.delete-cancel-btn { padding: 6px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); background: var(--color-surface); cursor: pointer; font-size: var(--fs-sm); }
.delete-confirm-btn { padding: 6px 16px; border: none; border-radius: var(--radius-mid); background: var(--danger); color: var(--on-accent); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
.delete-confirm-btn:hover { background: var(--danger-hover); }
</style>