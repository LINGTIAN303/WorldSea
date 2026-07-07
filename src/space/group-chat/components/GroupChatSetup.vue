<template>
  <div class="setup-panel">
    <div class="setup-scroll">
      <h2 class="setup-title">发起群聊讨论</h2>
      <p class="setup-subtitle">选择模板快速开始，或自定义配置</p>

      <div class="template-grid">
        <div
          v-for="tpl in templates"
          :key="tpl.id"
          class="template-card"
          :class="{ active: activeTemplate === tpl.id }"
          @click="applyTemplate(tpl.id)"
        >
          <div class="tpl-icon"><WsIcon :name="tpl.icon" size="md" /></div>
          <div class="tpl-name">{{ tpl.name }}</div>
          <div class="tpl-desc">{{ tpl.desc }}</div>
        </div>
      </div>

      <CollapsibleSection title="我的配置" :default-open="savedConfigs.length > 0" :badge="`${savedConfigs.length}`">
        <template #header-actions>
          <button class="add-btn" @click.stop="saveCurrentConfig" :disabled="participants.length < 2">保存</button>
        </template>
        <div v-if="savedConfigs.length === 0" class="empty-hint">尚未保存任何配置，调整好参与者后点击保存</div>
        <div v-else class="saved-list">
          <div
            v-for="cfg in savedConfigs"
            :key="cfg.id"
            class="saved-card"
            :class="{ active: activeSavedId === cfg.id }"
            @click="applySavedConfig(cfg.id)"
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
              <button class="sa-btn" title="删除" @click="deleteSavedConfig(cfg.id)"><WsIcon name="trash" size="xs" /></button>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="讨论话题" :default-open="true">
        <textarea v-model="topic" class="field-input" placeholder="描述你想讨论的主题..." rows="2"></textarea>
      </CollapsibleSection>

      <CollapsibleSection title="参与者" :default-open="true" :badge="`${participants.length}/8`">
        <template #header-actions>
          <button class="add-btn" @click.stop="addParticipant" :disabled="participants.length >= 8">+ 添加</button>
        </template>
        <div class="participant-list">
          <div
            v-for="(p, i) in participants"
            :key="i"
            class="participant-card"
            :style="{ '--p-color': p.color, borderColor: `${p.color}33`, background: `${p.color}08` }"
          >
            <div class="pc-header">
              <div class="pc-avatar" :style="{ background: p.color }" @click="cycleColor(i)">
                <span class="avatar-letter">{{ (p.name || '?')[0] }}</span>
              </div>
              <div class="pc-fields">
                <input v-model="p.name" class="pc-name" placeholder="名称" :class="{ 'has-error': isDuplicateName(i) }" />
                <input v-model="p.role" class="pc-role" placeholder="角色描述" />
              </div>
              <button class="pc-remove" @click="participants.splice(i, 1)" :disabled="participants.length <= 2"><WsIcon name="x" size="xs" /></button>
            </div>
            <div class="pc-model-row">
              <ModelFlyoutSelect :model-id="p.modelId" @update:model-id="onModelChange(i, $event)" />
              <span
                class="pc-health-dot"
                :class="getHealthClass(i)"
                :title="getHealthTooltip(i)"
                @click="checkHealth(i)"
              >●</span>
            </div>
            <div v-if="getFallbackChainDisplay(i).length > 1" class="pc-fallback-row">
              <span class="fallback-label">降级链：</span>
              <span
                v-for="(item, fi) in getFallbackChainDisplay(i)"
                :key="fi"
                class="fallback-item"
                :class="{ current: item.isCurrent }"
              >{{ item.name }}{{ fi < getFallbackChainDisplay(i).length - 1 ? ' → ' : '' }}</span>
            </div>
            <div v-if="isDuplicateName(i)" class="pc-warning">名称重复</div>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="高级设置" :default-open="false">
        <div class="setup-row">
          <div class="setup-field flex-1">
            <label class="field-label">最大轮次</label>
            <input v-model.number="maxRounds" type="number" class="field-input" min="1" max="50" />
          </div>
          <div class="setup-field flex-1">
            <label class="field-label">费用上限 (USD)</label>
            <input v-model.number="maxCostUsd" type="number" class="field-input" min="0.1" step="0.1" />
          </div>
        </div>
        <div class="setup-row">
          <div class="setup-field flex-1">
            <label class="field-label">并行发言数 <span class="field-hint">(1-3)</span></label>
            <div class="slider-row">
              <input v-model.number="parallelCount" type="range" min="1" max="3" step="1" class="slider-input" />
              <span class="slider-value">{{ parallelCount }}</span>
            </div>
          </div>
          <div class="setup-field flex-1">
            <label class="field-label">自动降级</label>
            <div class="toggle-row" @click="autoDegradation = !autoDegradation">
              <div class="toggle-track" :class="{ active: autoDegradation }">
                <div class="toggle-thumb"></div>
              </div>
              <span class="toggle-label">{{ autoDegradation ? '开启' : '关闭' }}</span>
            </div>
          </div>
        </div>
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
import { ref, computed, nextTick } from 'vue'
import { assignAgentColor } from '../types'
import { getModelInfo, calculateCost } from '../../../agent/modelRegistry'
import { FallbackChainImpl } from '../FallbackChain'
import type { ModelHealthResult } from '../types'
import CollapsibleSection from './CollapsibleSection.vue'
import ModelFlyoutSelect from './ModelFlyoutSelect.vue'
import WsIcon from '../../../ui/WsIcon.vue'

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
const activeSavedId = ref<string | null>(null)

const fallbackChain = new FallbackChainImpl()

const defaultModelId = computed(() => 'deepseek-chat')

interface ParticipantDraft {
  name: string
  role: string
  color: string
  modelId: string
}

interface SavedGroupConfig {
  id: string
  name: string
  participants: ParticipantDraft[]
  maxRounds: number
  maxCostUsd: number
  parallelCount: number
  autoDegradation: boolean
  savedAt: number
}

const STORAGE_KEY = 'worldsmith-group-chat-saved-configs'

function loadSavedConfigs(): SavedGroupConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistSavedConfigs(configs: SavedGroupConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
}

const savedConfigs = ref<SavedGroupConfig[]>(loadSavedConfigs())

const renamingId = ref<string | null>(null)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement[] | null>(null)

const participants = ref<ParticipantDraft[]>([
  { name: '历史学者', role: '从历史和文化角度分析', color: assignAgentColor(0), modelId: defaultModelId.value },
  { name: '魔法导师', role: '从魔法体系和规则角度分析', color: assignAgentColor(1), modelId: defaultModelId.value },
  { name: '种族使者', role: '从种族和社会角度分析', color: assignAgentColor(2), modelId: defaultModelId.value },
])

const healthResults = ref<Record<number, ModelHealthResult>>({})

const templates = [
  { id: 'debate', icon: 'sword', name: '辩论模式', desc: '正反方对立讨论', participants: [
    { name: '正方辩手', role: '支持观点，提供论据', color: '#3b82f6' },
    { name: '反方辩手', role: '反对观点，提出质疑', color: '#ef4444' },
    { name: '裁判', role: '客观评判，总结观点', color: '#22c55e' },
  ]},
  { id: 'brainstorm', icon: 'sparkles', name: '头脑风暴', desc: '多角度创意发散', participants: [
    { name: '创意总监', role: '提出创新方向', color: '#8b5cf6' },
    { name: '技术专家', role: '评估可行性', color: '#3b82f6' },
    { name: '用户代表', role: '从用户角度出发', color: '#f59e0b' },
  ]},
  { id: 'roundtable', icon: 'landmark', name: '圆桌讨论', desc: '平等协商共识', participants: [
    { name: '主持人', role: '引导讨论方向', color: '#6c5ce7' },
    { name: '参与者A', role: '提供专业视角', color: '#3b82f6' },
    { name: '参与者B', role: '提供实践视角', color: '#22c55e' },
    { name: '参与者C', role: '提供批判视角', color: '#ef4444' },
  ]},
  { id: 'analysis', icon: 'search', name: '深度分析', desc: '专家逐层剖析', participants: [
    { name: '分析师', role: '数据驱动的分析', color: '#3b82f6' },
    { name: '审查员', role: '发现逻辑漏洞', color: '#ef4444' },
  ]},
]

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
  healthResults.value = {}
}

function addParticipant(): void {
  if (participants.value.length >= 8) return
  const idx = participants.value.length
  participants.value.push({
    name: `Agent ${idx + 1}`,
    role: '参与者',
    color: assignAgentColor(idx),
    modelId: defaultModelId.value,
  })
}

const colorPalette = ['#3b82f6', '#8b5cf6', '#ef4444', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#f97316']

function cycleColor(idx: number): void {
  const current = participants.value[idx].color
  const ci = colorPalette.indexOf(current)
  participants.value[idx].color = colorPalette[(ci + 1) % colorPalette.length]
}

function isDuplicateName(idx: number): boolean {
  const name = participants.value[idx]?.name?.trim()
  if (!name) return false
  return participants.value.some((p, i) => i !== idx && p.name.trim() === name)
}

function getHealthClass(idx: number): string {
  const r = healthResults.value[idx]
  if (!r) return 'health-unknown'
  if (r.status === 'healthy') return 'health-ok'
  if (r.status === 'slow') return 'health-slow'
  return 'health-bad'
}

function getHealthTooltip(idx: number): string {
  const r = healthResults.value[idx]
  if (!r) return '点击检测'
  if (r.status === 'healthy') return `健康 (${r.latency}ms)`
  if (r.status === 'slow') return `响应慢 (${r.latency}ms)`
  return r.error || '不可达'
}

async function checkHealth(idx: number): Promise<void> {
  const p = participants.value[idx]
  if (!p) return
  healthResults.value[idx] = {
    status: 'unknown' as any,
    latency: 0,
    checkedAt: Date.now(),
  }
  try {
    const info = getModelInfo(p.modelId)
    if (!info) {
      healthResults.value[idx] = {
        status: 'unreachable',
        latency: 0,
        error: '模型未在注册表中找到',
        checkedAt: Date.now(),
      }
      return
    }
    const chain = fallbackChain.getFullChain(p.modelId)
    const hasFallback = chain.length > 1
    healthResults.value[idx] = {
      status: 'healthy',
      latency: 0,
      checkedAt: Date.now(),
      error: hasFallback ? undefined : '无降级链',
    }
  } catch {
    healthResults.value[idx] = {
      status: 'unreachable',
      latency: 0,
      error: '检测失败',
      checkedAt: Date.now(),
    }
  }
}

function onModelChange(idx: number, modelId: string): void {
  participants.value[idx].modelId = modelId
  delete healthResults.value[idx]
}

function getFallbackChainDisplay(idx: number): { id: string; name: string; isCurrent: boolean }[] {
  const p = participants.value[idx]
  if (!p) return []
  return fallbackChain.getChainDisplay(p.modelId)
}

const canStart = computed(() =>
  topic.value.trim().length > 0 &&
  participants.value.length >= 2 &&
  participants.value.length <= 8 &&
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

function saveCurrentConfig(): void {
  const cfg: SavedGroupConfig = {
    id: crypto.randomUUID(),
    name: participants.value.map(p => p.name).join(' & '),
    participants: JSON.parse(JSON.stringify(participants.value)),
    maxRounds: maxRounds.value,
    maxCostUsd: maxCostUsd.value,
    parallelCount: parallelCount.value,
    autoDegradation: autoDegradation.value,
    savedAt: Date.now(),
  }
  savedConfigs.value.unshift(cfg)
  persistSavedConfigs(savedConfigs.value)
  activeSavedId.value = cfg.id
}

function applySavedConfig(id: string): void {
  activeSavedId.value = id
  activeTemplate.value = null
  const cfg = savedConfigs.value.find(c => c.id === id)
  if (!cfg) return
  participants.value = JSON.parse(JSON.stringify(cfg.participants))
  maxRounds.value = cfg.maxRounds
  maxCostUsd.value = cfg.maxCostUsd
  parallelCount.value = cfg.parallelCount
  autoDegradation.value = cfg.autoDegradation
  healthResults.value = {}
}

function startRename(id: string, currentName: string): void {
  renamingId.value = id
  renameValue.value = currentName
  nextTick(() => {
    const inputs = renameInputRef.value
    if (inputs && inputs.length > 0) {
      inputs[0]?.focus()
      inputs[0]?.select()
    }
  })
}

function confirmRename(id: string): void {
  if (renamingId.value !== id) return
  const trimmed = renameValue.value.trim()
  if (trimmed) {
    const cfg = savedConfigs.value.find(c => c.id === id)
    if (cfg) {
      cfg.name = trimmed
      persistSavedConfigs(savedConfigs.value)
    }
  }
  renamingId.value = null
  renameValue.value = ''
}

function cancelRename(): void {
  renamingId.value = null
  renameValue.value = ''
}

function deleteSavedConfig(id: string): void {
  savedConfigs.value = savedConfigs.value.filter(c => c.id !== id)
  persistSavedConfigs(savedConfigs.value)
  if (activeSavedId.value === id) {
    activeSavedId.value = null
  }
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

.template-grid {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}

.template-card {
  flex: 1;
  padding: 10px 8px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  cursor: pointer;
  text-align: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.template-card:hover {
  border-color: var(--color-primary);
  background: rgba(108, 92, 231, 0.04);
}

.template-card.active {
  border-color: var(--color-primary);
  background: rgba(108, 92, 231, 0.08);
}

.tpl-icon {
  font-size: 18px;
  margin-bottom: 4px;
}

.tpl-name {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
}

.tpl-desc {
  font-size: 10px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

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

.setup-field {
}

.setup-field.flex-1 {
  flex: 1;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.field-hint {
  color: var(--color-text-tertiary);
  font-weight: 400;
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

.setup-row {
  display: flex;
  gap: 16px;
}

.participant-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.participant-card {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  transition: border-color 0.15s;
}

.pc-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pc-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.2);
  transition: transform 0.15s;
}

.pc-avatar:hover {
  transform: scale(1.1);
}

.avatar-letter {
  color: white;
  font-weight: 700;
  font-size: var(--font-size-sm);
}

.pc-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pc-name {
  border: none;
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--p-color, var(--color-text));
  background: transparent;
  outline: none;
  width: 100%;
}

.pc-name.has-error {
  color: #ef4444;
}

.pc-role {
  border: none;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  background: transparent;
  outline: none;
  width: 100%;
}

.pc-remove {
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  padding: 2px 6px;
}

.pc-remove:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pc-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  margin-left: 40px;
}

.pc-health-dot {
  cursor: pointer;
  font-size: 12px;
  transition: transform 0.15s;
}

.pc-health-dot:hover {
  transform: scale(1.3);
}

.health-unknown { color: var(--color-text-tertiary); }
.health-ok { color: #10b981; }
.health-slow { color: #f59e0b; }
.health-bad { color: #ef4444; }

.pc-fallback-row {
  margin-top: 4px;
  margin-left: 40px;
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
}

.fallback-label {
  font-size: 10px;
  color: var(--color-text-tertiary);
}

.fallback-item {
  font-size: 10px;
  color: var(--color-text-tertiary);
}

.fallback-item.current {
  color: var(--color-primary);
  font-weight: 600;
}

.pc-warning {
  margin-top: 4px;
  margin-left: 40px;
  font-size: 10px;
  color: #ef4444;
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

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.slider-input {
  flex: 1;
  accent-color: var(--color-primary);
  height: 4px;
}

.slider-value {
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--color-primary);
  min-width: 16px;
  text-align: center;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
}

.toggle-track {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--color-border);
  position: relative;
  transition: background 0.2s;
}

.toggle-track.active {
  background: var(--color-primary);
}

.toggle-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: left 0.2s;
}

.toggle-track.active .toggle-thumb {
  left: 18px;
}

.toggle-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
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
