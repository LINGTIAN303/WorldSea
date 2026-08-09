<template>
  <Teleport to="body">
    <Transition name="panel-slide">
      <div v-if="visible" class="agent-manager-overlay" @click.self="onOverlayClick">
        <div class="agent-manager-panel" :style="panelStyle">
          <div class="panel-header">
            <span class="panel-title">Agent 管理</span>
            <button class="close-btn" @click="$emit('close')"><WsIcon name="x" size="xs" /></button>
          </div>

          <div class="panel-body">
            <div class="agent-grid">
              <div
                v-for="agent in agentRegistry.agents"
                :key="agent.id"
                class="agent-card"
                @click="onEditAgent(agent)"
              >
                <div class="agent-avatar" :style="{ background: agent.color }">{{ agent.avatar }}</div>
                <div class="agent-info">
                  <span class="agent-name">{{ agent.name }}</span>
                  <span class="agent-role">{{ agent.role }}</span>
                </div>
                <span class="agent-source"><WsIcon :name="agent.sourceType === 'entity' ? 'landmark' : 'pencil'" size="xs" /></span>
                <button class="agent-delete-btn" @click.stop="onDeleteAgent(agent.id)" title="删除"><WsIcon name="x" size="xs" /></button>
              </div>
              <div v-if="agentRegistry.agents.length === 0" class="agent-empty">暂无 Agent，点击下方创建</div>
            </div>

            <button class="create-btn" @click="showCreateDialog = true"><WsIcon name="plus" size="xs" /> 创建 Agent</button>
          </div>

          <CreateAgentDialog
            v-if="showCreateDialog"
            @close="showCreateDialog = false"
            @created="onAgentCreated"
            @updated="onAgentUpdated"
          />

          <CreateAgentDialog
            v-if="showEditDialog && editingAgent"
            :agent="editingAgent"
            @close="showEditDialog = false; editingAgent = null"
            @updated="onAgentUpdated"
          />

          <div v-if="deleteConfirmId" class="delete-confirm-overlay" @click.self="deleteConfirmId = null">
            <div class="delete-confirm-dialog">
              <div class="delete-confirm-text">确定删除此 Agent？已有群中的成员不受影响。</div>
              <div class="delete-confirm-actions">
                <button class="delete-cancel-btn" @click="deleteConfirmId = null">取消</button>
                <button class="delete-confirm-btn" @click="confirmDelete">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useAgentRegistryStore } from '../management/AgentRegistryStore'
import type { ChatAgent } from '../types'
import CreateAgentDialog from './CreateAgentDialog.vue'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{
  visible: boolean
  anchorRect?: DOMRect
}>()

const emit = defineEmits<{ close: [] }>()

const agentRegistry = useAgentRegistryStore()
const showCreateDialog = ref(false)
const showEditDialog = ref(false)
const editingAgent = ref<ChatAgent | null>(null)
const deleteConfirmId = ref<string | null>(null)

const panelStyle = computed(() => {
  if (props.anchorRect) {
    return {
      position: 'fixed' as const,
      top: `${props.anchorRect.bottom + 6}px`,
      right: `${window.innerWidth - props.anchorRect.right}px`,
    }
  }
  return {
    position: 'fixed' as const,
    top: '56px',
    right: '16px',
  }
})

function onOverlayClick(): void {
  // 内部弹窗打开时，点击 overlay 不关闭面板（避免关闭编辑/创建弹窗时误关面板）
  if (showCreateDialog.value || showEditDialog.value || deleteConfirmId.value) return
  emit('close')
}

function onEditAgent(agent: ChatAgent): void {
  editingAgent.value = { ...agent }
  showEditDialog.value = true
}

async function onAgentCreated(agent: ChatAgent): Promise<void> {
  agentRegistry.addAgent(agent)
  await agentRegistry.persistAgent(agent)
  showCreateDialog.value = false
}

async function onAgentUpdated(agent: ChatAgent): Promise<void> {
  agentRegistry.updateAgent(agent.id, agent)
  await agentRegistry.persistAgent(agent)
  showEditDialog.value = false
  editingAgent.value = null
}

function onDeleteAgent(id: string): void {
  deleteConfirmId.value = id
}

async function confirmDelete(): Promise<void> {
  if (deleteConfirmId.value) {
    await agentRegistry.deleteAgentAndPersist(deleteConfirmId.value)
    deleteConfirmId.value = null
  }
}

// 面板关闭时重置内部弹窗状态，避免下次打开时残留
watch(() => props.visible, (v) => {
  if (!v) {
    showCreateDialog.value = false
    showEditDialog.value = false
    editingAgent.value = null
    deleteConfirmId.value = null
  }
})

onMounted(async () => {
  await agentRegistry.loadFromDB()
})
</script>

<style scoped>
.agent-manager-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.agent-manager-panel {
  width: 340px;
  max-height: 480px;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
}

.panel-title { font-size: var(--fs-base); font-weight: 600; color: var(--color-text); }
.close-btn { background: none; border: none; cursor: pointer; font-size: var(--fs-lg); opacity: 0.5; color: var(--color-text-secondary); }
.close-btn:hover { opacity: 1; }

.panel-body { flex: 1; overflow-y: auto; padding: 12px; }

.agent-grid { display: flex; flex-direction: column; gap: 4px; }

.agent-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-mid);
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}
.agent-card:hover { background: var(--color-surface); }

.agent-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: var(--fs-md);
  flex-shrink: 0;
}

.agent-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.agent-name { font-size: var(--fs-md); font-weight: 600; color: var(--color-text); }
.agent-role { font-size: var(--fs-xs); color: var(--color-text-tertiary); }
.agent-source { font-size: var(--fs-2xs); color: var(--color-text-tertiary); }

.agent-delete-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  border-radius: 50%;
  cursor: pointer;
  font-size: var(--fs-2xs);
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s;
}
.agent-card:hover .agent-delete-btn { opacity: 1; }
.agent-delete-btn:hover { background: var(--danger-soft); color: var(--danger); }

.agent-empty { padding: 16px; font-size: var(--fs-sm); color: var(--color-text-tertiary); text-align: center; }

.create-btn {
  width: 100%;
  margin-top: 12px;
  padding: 8px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-mid);
  background: transparent;
  color: var(--color-primary);
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.create-btn:hover { background: var(--color-surface); border-color: var(--color-primary); }

.delete-confirm-overlay { position: absolute; inset: 0; background: var(--overlay); z-index: var(--z-modal); display: flex; align-items: center; justify-content: center; }
.delete-confirm-dialog { background: var(--color-surface-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-2xl); padding: 20px; min-width: 260px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
.delete-confirm-text { font-size: var(--fs-md); margin-bottom: 16px; line-height: 1.5; }
.delete-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; }
.delete-cancel-btn { padding: 6px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-mid); background: var(--color-surface); cursor: pointer; font-size: var(--fs-sm); }
.delete-confirm-btn { padding: 6px 16px; border: none; border-radius: var(--radius-mid); background: var(--danger); color: var(--on-accent); cursor: pointer; font-size: var(--fs-sm); font-weight: 600; }
.delete-confirm-btn:hover { background: var(--danger-hover); }

.panel-slide-enter-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.panel-slide-leave-active { transition: opacity 0.1s ease, transform 0.1s ease; }
.panel-slide-enter-from { opacity: 0; transform: translateY(-8px) scale(0.97); }
.panel-slide-leave-to { opacity: 0; transform: translateY(-4px) scale(0.99); }
</style>