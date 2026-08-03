<template>
  <div class="setup-panel">
    <div class="setup-scroll">
      <h2 class="setup-title">发起群聊讨论</h2>
      <p class="setup-subtitle">选择模板快速开始，或自定义配置</p>

      <TemplateSelector
        :templates="templates"
        :active-template="activeTemplate"
        @apply="applyTemplate"
      />

      <CollapsibleSection title="我的配置" :default-open="savedConfigs.length > 0" :badge="`${savedConfigs.length}`">
        <template #header-actions>
          <button class="add-btn" @click.stop="onSaveCurrentConfig" :disabled="participants.length < 2">保存</button>
        </template>
        <SavedConfigsPanel
          :configs="savedConfigs"
          :active-id="activeSavedId"
          @apply="onApplySavedConfig"
          @delete="onDeleteSavedConfig"
          @rename="onRenameSavedConfig"
        />
      </CollapsibleSection>

      <CollapsibleSection title="讨论话题" :default-open="true">
        <textarea v-model="topic" class="field-input" placeholder="描述你想讨论的主题..." rows="2"></textarea>
      </CollapsibleSection>

      <CollapsibleSection title="参与者" :default-open="true" :badge="`${participants.length}/8`">
        <template #header-actions>
          <button class="add-btn" @click.stop="addParticipant" :disabled="participants.length >= 8">+ 添加</button>
        </template>
        <ParticipantList v-model="participants" />
      </CollapsibleSection>

      <CollapsibleSection title="高级设置" :default-open="false">
        <AdvancedSettings
          :max-rounds="maxRounds"
          :max-cost-usd="maxCostUsd"
          :parallel-count="parallelCount"
          :auto-degradation="autoDegradation"
          @update:max-rounds="maxRounds = $event"
          @update:max-cost-usd="maxCostUsd = $event"
          @update:parallel-count="parallelCount = $event"
          @update:auto-degradation="autoDegradation = $event"
        />
      </CollapsibleSection>
    </div>

    <div class="setup-footer">
      <div class="cost-estimate" v-if="topic">
        <span class="estimate-label">预估费用：</span>
        <span class="estimate-value">{{ estimateRange }}</span>
      </div>
      <div class="setup-actions">
        <button class="cancel-btn" @click="$emit('cancel')">取消</button>
        <button class="start-btn" :disabled="!canStart" @click="onStart">🚀 开始讨论</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { assignAgentColor } from '../types'
import { getModelInfo, calculateCost } from '@worldsmith/agent-runtime'
import CollapsibleSection from './CollapsibleSection.vue'
import TemplateSelector from './setup/TemplateSelector.vue'
import SavedConfigsPanel from './setup/SavedConfigsPanel.vue'
import ParticipantList from './setup/ParticipantList.vue'
import AdvancedSettings from './setup/AdvancedSettings.vue'
import { useSavedConfigs } from '../composables/useSavedConfigs'
import {
  GROUP_CHAT_TEMPLATES,
  MAX_PARTICIPANTS,
  type ParticipantDraft,
} from './setup/types'

const emit = defineEmits<{
  start: [config: {
    topic: string
    participants: Array<{ name: string; role: string; color: string; modelId: string }>
    maxRounds: number
    maxCostUsd: number
    parallelCount: number
    autoDegradation: boolean
  }]
  cancel: []
}>()

const topic = ref('')
const maxRounds = ref(20)
const maxCostUsd = ref(1.0)
const parallelCount = ref(1)
const autoDegradation = ref(true)
const activeTemplate = ref<string | null>(null)

const defaultModelId = computed(() => 'deepseek-chat')

const participants = ref<ParticipantDraft[]>([
  { name: '历史学者', role: '从历史和文化角度分析', color: assignAgentColor(0), modelId: defaultModelId.value },
  { name: '魔法导师', role: '从魔法体系和规则角度分析', color: assignAgentColor(1), modelId: defaultModelId.value },
  { name: '种族使者', role: '从种族和社会角度分析', color: assignAgentColor(2), modelId: defaultModelId.value },
])

// 「我的配置」composable
const {
  savedConfigs,
  activeSavedId,
  saveCurrentConfig,
  getConfig,
  setActive,
  deleteSavedConfig,
  renameConfig,
} = useSavedConfigs()

const templates = GROUP_CHAT_TEMPLATES

function applyTemplate(id: string): void {
  activeTemplate.value = activeTemplate.value === id ? null : id
  activeSavedId.value = null
  if (!activeTemplate.value) return
  const tpl = templates.find(t => t.id === id)
  if (!tpl) return
  participants.value = tpl.participants.map((p) => ({
    ...p,
    modelId: defaultModelId.value,
  }))
}

function addParticipant(): void {
  if (participants.value.length >= MAX_PARTICIPANTS) return
  const idx = participants.value.length
  participants.value.push({
    name: `Agent ${idx + 1}`,
    role: '参与者',
    color: assignAgentColor(idx),
    modelId: defaultModelId.value,
  })
}

function isDuplicateName(idx: number): boolean {
  const name = participants.value[idx]?.name?.trim()
  if (!name) return false
  return participants.value.some((p, i) => i !== idx && p.name.trim() === name)
}

const canStart = computed(() =>
  topic.value.trim().length > 0 &&
  participants.value.length >= 2 &&
  participants.value.length <= MAX_PARTICIPANTS &&
  !participants.value.some((_, i) => isDuplicateName(i))
)

const estimateRange = computed(() => {
  const avgInputTokens = 2000
  const avgOutputTokens = 500
  let minCost = 0
  let maxCost = 0
  for (const p of participants.value) {
    const info = getModelInfo(p.modelId)
    if (!info) continue
    const costPerRound = calculateCost(p.modelId, avgInputTokens, avgOutputTokens)
    minCost += costPerRound.total * maxRounds.value * 0.3
    maxCost += costPerRound.total * maxRounds.value * 0.8
  }
  const fmtMin = minCost.toFixed(2)
  const fmtMax = maxCost.toFixed(2)
  return `$${fmtMin} - $${fmtMax}`
})

/** 保存当前配置到「我的配置」列表 */
function onSaveCurrentConfig(): void {
  saveCurrentConfig({
    participants: participants.value,
    maxRounds: maxRounds.value,
    maxCostUsd: maxCostUsd.value,
    parallelCount: parallelCount.value,
    autoDegradation: autoDegradation.value,
  })
}

/** 应用已保存的配置到当前设置 */
function onApplySavedConfig(id: string): void {
  setActive(id)
  activeTemplate.value = null
  const cfg = getConfig(id)
  if (!cfg) return
  participants.value = JSON.parse(JSON.stringify(cfg.participants)) as ParticipantDraft[]
  maxRounds.value = cfg.maxRounds
  maxCostUsd.value = cfg.maxCostUsd
  parallelCount.value = cfg.parallelCount
  autoDegradation.value = cfg.autoDegradation
}

function onDeleteSavedConfig(id: string): void {
  deleteSavedConfig(id)
}

function onRenameSavedConfig(id: string, newName: string): void {
  renameConfig(id, newName)
}

function onStart(): void {
  emit('start', {
    topic: topic.value.trim(),
    participants: participants.value.map(p => ({ name: p.name, role: p.role, color: p.color, modelId: p.modelId })),
    maxRounds: maxRounds.value,
    maxCostUsd: maxCostUsd.value,
    parallelCount: parallelCount.value,
    autoDegradation: autoDegradation.value,
  })
}
</script>

<style scoped>
.setup-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 560px;
  margin: 0 auto;
}

.setup-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 24px 8px;
}

.setup-title {
  font-size: var(--font-size-lg);
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 4px;
  text-align: center;
}

.setup-subtitle {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  text-align: center;
  margin: 0 0 20px;
}

.field-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: var(--color-surface-elevated);
  color: var(--color-text);
  outline: none;
  resize: vertical;
}

.field-input:focus {
  border-color: var(--color-primary);
}

.add-btn {
  padding: 3px 10px;
  border: 1px dashed rgba(108, 92, 231, 0.4);
  border-radius: 6px;
  font-size: var(--font-size-2xs);
  color: var(--color-primary);
  cursor: pointer;
  background: rgba(108, 92, 231, 0.06);
}

.add-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.setup-footer {
  flex-shrink: 0;
  padding: 12px 24px 16px;
  border-top: 1px solid var(--color-border);
  background: var(--color-surface);
}

.cost-estimate {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-bottom: 16px;
}

.estimate-value {
  font-weight: 600;
  color: var(--color-primary);
}

.setup-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.cancel-btn, .start-btn {
  padding: 8px 20px;
  border-radius: 10px;
  font-size: var(--font-size-sm);
  font-weight: 600;
  cursor: pointer;
  border: none;
}

.cancel-btn {
  background: var(--color-surface-elevated);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.start-btn {
  background: var(--color-primary);
  color: white;
  box-shadow: 0 2px 8px rgba(108, 92, 231, 0.3);
}

.start-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}
</style>
