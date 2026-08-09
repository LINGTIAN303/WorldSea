<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @click.self="$emit('close')"></div>
    <div
      ref="dialogRef"
      class="create-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-group-dialog-title"
      tabindex="-1"
    >
      <div id="create-group-dialog-title" class="dialog-title">新建群聊</div>

      <div class="avatar-section">
        <div class="avatar-placeholder"><WsIcon name="camera" size="sm" /></div>
        <input class="name-input" v-model="groupName" placeholder="输入群名" />
      </div>

      <div class="members-section">
        <div class="section-label">添加成员</div>
        <div class="selected-members">
          <span v-for="m in selectedMembers" :key="m.id" class="member-chip">
            {{ m.name }}
            <button class="chip-remove" :aria-label="`移除 ${m.name}`" @click="toggleMember(m)"><WsIcon name="x" size="xs" /></button>
          </span>
        </div>
        <input class="member-search" v-model="memberSearch" placeholder="搜索 Agent..." />
        <div class="agent-list">
          <div
            v-for="agent in filteredAgents"
            :key="agent.id"
            class="agent-item"
            :class="{ selected: isSelected(agent.id) }"
            role="checkbox"
            :aria-checked="isSelected(agent.id)"
            tabindex="0"
            :aria-label="`${isSelected(agent.id) ? '移除' : '添加'} ${agent.name}（${agent.role}）`"
            @click="toggleMember(agent)"
            @keydown.enter.prevent="toggleMember(agent)"
            @keydown.space.prevent="toggleMember(agent)"
          >
            <div class="agent-avatar" :style="{ background: agent.color }">{{ agent.name[0] }}</div>
            <div class="agent-info">
              <span class="agent-name">{{ agent.name }}</span>
              <span class="agent-role">{{ agent.role }}</span>
            </div>
            <span v-if="isSelected(agent.id)" class="agent-check">✓</span>
          </div>
          <div v-if="filteredAgents.length === 0" class="agent-list-empty">无匹配 Agent</div>
        </div>
      </div>

      <button class="create-btn" :disabled="!groupName.trim() || selectedMembers.length === 0" @click="onCreate">创建群聊</button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useFocusTrap } from '@/composables/useFocusTrap'

export interface AgentItem {
  id: string
  name: string
  role: string
  color: string
  avatar: string
  systemPrompt: string
  modelId?: string
  enabledTools: string[]
  enabledSkills: string[]
  baseLayerMode?: string
  customBaseLayer?: string
  toolSource?: string
  providerSlotId?: string
}

export interface CreateGroupData {
  name: string
  mode: 'casual'
  members: AgentItem[]
}

const props = defineProps<{
  availableAgents?: AgentItem[]
}>()

const emit = defineEmits<{
  close: []
  created: [data: CreateGroupData]
}>()

const dialogRef = ref<HTMLElement | null>(null)

const { activate } = useFocusTrap(dialogRef, {
  escapeDeactivates: true,
  onEscape: () => emit('close'),
})

onMounted(() => {
  nextTick(() => activate())
})

const groupName = ref('')
const selectedMembers = ref<AgentItem[]>([])
const memberSearch = ref('')

const filteredAgents = computed(() => {
  const agents = props.availableAgents ?? []
  if (!memberSearch.value) return agents
  const q = memberSearch.value.toLowerCase()
  return agents.filter(a =>
    a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q)
  )
})

function isSelected(id: string): boolean {
  return selectedMembers.value.some(m => m.id === id)
}

function toggleMember(agent: AgentItem): void {
  if (isSelected(agent.id)) {
    selectedMembers.value = selectedMembers.value.filter(m => m.id !== agent.id)
  } else {
    selectedMembers.value = [...selectedMembers.value, agent]
  }
}

function onCreate(): void {
  if (!groupName.value.trim() || selectedMembers.value.length === 0) return
  emit('created', {
    name: groupName.value.trim(),
    mode: 'casual',
    members: [...selectedMembers.value],
  })
}
</script>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 9998; }
.create-dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-2xl); padding: 20px; min-width: 360px; max-height: 80vh; overflow-y: auto; z-index: 9999; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.dialog-title { font-size: var(--fs-lg); font-weight: 600; margin-bottom: 16px; text-align: center; }

.avatar-section { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; justify-content: center; }
.avatar-placeholder { width: 48px; height: 48px; border-radius: 50%; background: var(--color-surface); border: 2px dashed var(--color-border); display: flex; align-items: center; justify-content: center; font-size: var(--fs-xl); cursor: pointer; }
.name-input { border: none; border-bottom: 1px solid var(--color-border); font-size: var(--fs-lg); font-weight: 600; background: transparent; outline: none; text-align: center; width: 160px; }

.section-label { font-size: var(--fs-xs); color: var(--color-text-tertiary); font-weight: 600; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }

.members-section { margin-bottom: 16px; }
.selected-members { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.member-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: color-mix(in srgb, var(--color-primary) 10%, transparent); border-radius: var(--radius-sm); font-size: var(--fs-xs); }
.chip-remove { cursor: pointer; opacity: 0.5; background: none; border: none; padding: 0; display: inline-flex; align-items: center; color: inherit; }
.chip-remove:hover { opacity: 1; }
.member-search { width: 100%; padding: 6px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); font-size: var(--fs-sm); background: var(--color-surface); outline: none; margin-bottom: 6px; }

.agent-list { max-height: 180px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-mid); }
.agent-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; transition: background 0.12s; }
.agent-item:hover { background: var(--color-surface); }
.agent-item.selected { background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
.agent-avatar { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: var(--fs-xs); flex-shrink: 0; }
.agent-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.agent-name { font-size: var(--fs-sm); font-weight: 600; }
.agent-role { font-size: var(--fs-2xs); color: var(--color-text-tertiary); }
.agent-check { color: var(--color-primary); font-weight: 700; font-size: var(--fs-base); }
.agent-list-empty { padding: 12px; font-size: var(--fs-xs); color: var(--color-text-tertiary); text-align: center; }

.create-btn { width: 100%; padding: 10px; border: none; background: var(--color-primary); color: var(--on-accent); border-radius: var(--radius-md); cursor: pointer; font-size: var(--fs-md); font-weight: 600; }
.create-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>