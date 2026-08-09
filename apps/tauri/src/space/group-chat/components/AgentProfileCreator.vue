<template>
  <div class="profile-creator-overlay" @click.self="$emit('close')">
    <div class="profile-creator">
      <div class="creator-header">
        <h3>{{ isEditing ? '编辑 Agent' : '创建 Agent' }}</h3>
        <button class="btn-close" @click="$emit('close')">×</button>
      </div>

      <div class="creator-body">
        <div class="form-section">
          <label>名称</label>
          <input v-model="form.name" class="form-input" placeholder="如: 世界构建师" />
        </div>

        <div class="form-row">
          <div class="form-section">
            <label>头像</label>
            <div class="avatar-picker">
              <button
                v-for="emoji in avatarOptions"
                :key="emoji"
                class="avatar-option"
                :class="{ selected: form.avatar === emoji }"
                @click="form.avatar = emoji"
              >
                {{ emoji }}
              </button>
            </div>
          </div>

          <div class="form-section">
            <label>标识色</label>
            <div class="color-picker">
              <button
                v-for="color in colorOptions"
                :key="color"
                class="color-option"
                :class="{ selected: form.color === color }"
                :style="{ backgroundColor: color }"
                @click="form.color = color"
              />
            </div>
          </div>
        </div>

        <div class="form-section">
          <label>系统提示词</label>
          <textarea
            v-model="form.systemPrompt"
            class="form-textarea"
            placeholder="定义这个 Agent 的身份、性格和行为规则..."
            rows="6"
          />
        </div>

        <div class="form-section">
          <label>Provider 池</label>
          <select v-model="form.providerSlotId" class="form-select">
            <option value="">请选择 Provider 池</option>
            <option
              v-for="slot in profileStore.slots"
              :key="slot.id"
              :value="slot.id"
            >
              {{ slot.name }} ({{ slot.entries.length }} 个配置)
            </option>
          </select>
        </div>

        <div class="form-section">
          <label>专长领域 <span class="hint">（逗号分隔）</span></label>
          <input
            v-model="expertiseInput"
            class="form-input"
            placeholder="如: 魔法系统, 历史, 地理"
          />
        </div>

        <details class="form-details">
          <summary>发言欲望设置</summary>
          <div class="form-section">
            <label>基础发言概率: {{ form.baseProbability.toFixed(1) }}</label>
            <input
              type="range"
              v-model.number="form.baseProbability"
              min="0"
              max="1"
              step="0.1"
              class="form-range"
            />
          </div>
          <div class="form-section">
            <label>话痨系数: {{ form.talkativeness.toFixed(1) }}</label>
            <input
              type="range"
              v-model.number="form.talkativeness"
              min="0"
              max="2"
              step="0.1"
              class="form-range"
            />
          </div>
        </details>
      </div>

      <div class="creator-footer">
        <button class="btn-cancel" @click="$emit('close')">取消</button>
        <button class="btn-save" :disabled="!canSave" @click="save">
          {{ isEditing ? '保存' : '创建' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { useAgentProfileStore } from '@/stores/agentProfileStore'
import type { AgentProfile } from '@agent/group-chat/types'

const props = defineProps<{
  editingProfile?: AgentProfile
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const profileStore = useAgentProfileStore()
const isEditing = computed(() => !!props.editingProfile)

const avatarOptions = ['🤖', '🧙', '📚', '🎨', '⚔️', '🏰', '🌍', '🔮', '📜', '🗡️', '🌙', '☀️']
const colorOptions = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4']

const form = reactive({
  name: props.editingProfile?.name ?? '',
  avatar: props.editingProfile?.avatar ?? '🤖',
  color: props.editingProfile?.color ?? '#6366f1',
  systemPrompt: props.editingProfile?.systemPrompt ?? '',
  providerSlotId: props.editingProfile?.providerSlotId ?? '',
  baseProbability: props.editingProfile?.speakingDesire?.baseProbability ?? 0.3,
  talkativeness: props.editingProfile?.speakingDesire?.talkativeness ?? 1.0,
})

const expertiseInput = ref(
  props.editingProfile?.personality?.expertise?.join(', ') ?? ''
)

const canSave = computed(() =>
  form.name.trim() !== '' &&
  form.systemPrompt.trim() !== '' &&
  form.providerSlotId !== ''
)

async function save(): Promise<void> {
  if (!canSave.value) return

  const expertise = expertiseInput.value
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean)

  if (isEditing.value && props.editingProfile) {
    await profileStore.updateProfile(props.editingProfile.id, {
      name: form.name,
      avatar: form.avatar,
      color: form.color,
      systemPrompt: form.systemPrompt,
      providerSlotId: form.providerSlotId,
      personality: { expertise },
      speakingDesire: {
        baseProbability: form.baseProbability,
        talkativeness: form.talkativeness,
      },
    })
  } else {
    await profileStore.createProfile({
      name: form.name,
      avatar: form.avatar,
      color: form.color,
      systemPrompt: form.systemPrompt,
      providerSlotId: form.providerSlotId,
      enabled: true,
      personality: { expertise },
      speakingDesire: {
        baseProbability: form.baseProbability,
        talkativeness: form.talkativeness,
      },
    })
  }

  emit('saved')
}
</script>

<style scoped>
.profile-creator-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.profile-creator {
  width: 520px;
  max-height: 80vh;
  background: var(--bg-primary, #1a1a2e);
  border-radius: 12px;
  border: 1px solid var(--border-color, #2a2a4a);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.creator-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #2a2a4a);
}

.creator-header h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
}

.btn-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #888);
  font-size: var(--fs-xl);
  cursor: pointer;
  border-radius: 4px;
}

.btn-close:hover {
  background: var(--bg-hover, #2a2a4a);
}

.creator-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-section label {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--text-secondary, #888);
}

.hint {
  font-weight: 400;
  font-size: var(--fs-xs);
}

.form-input,
.form-textarea,
.form-select {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color, #2a2a4a);
  background: var(--bg-secondary, #16162a);
  color: var(--text-primary, #e0e0e0);
  font-size: var(--fs-md);
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus,
.form-select:focus {
  outline: none;
  border-color: var(--accent, #6366f1);
}

.form-textarea {
  resize: vertical;
  line-height: 1.5;
}

.form-row {
  display: flex;
  gap: 16px;
}

.form-row .form-section {
  flex: 1;
}

.avatar-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.avatar-option {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid transparent;
  background: var(--bg-secondary, #16162a);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-option.selected {
  border-color: var(--accent, #6366f1);
}

.avatar-option:hover {
  background: var(--bg-hover, #2a2a4a);
}

.color-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.color-option {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
}

.color-option.selected {
  border-color: white;
  box-shadow: 0 0 0 2px var(--accent, #6366f1);
}

.form-range {
  width: 100%;
  accent-color: var(--accent, #6366f1);
}

.form-details {
  border: 1px solid var(--border-color, #2a2a4a);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
}

.form-details summary {
  font-size: var(--fs-md);
  font-weight: 500;
  cursor: pointer;
  color: var(--text-primary, #e0e0e0);
}

.form-details[open] {
  padding-bottom: 12px;
}

.form-details .form-section {
  margin-top: 12px;
}

.creator-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color, #2a2a4a);
}

.btn-cancel {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color, #2a2a4a);
  background: transparent;
  color: var(--text-secondary, #888);
  font-size: var(--fs-md);
  cursor: pointer;
}

.btn-cancel:hover {
  background: var(--bg-hover, #2a2a4a);
}

.btn-save {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  border: none;
  background: var(--accent, #6366f1);
  color: white;
  font-size: var(--fs-md);
  font-weight: 500;
  cursor: pointer;
}

.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-save:not(:disabled):hover {
  filter: brightness(1.1);
}
</style>