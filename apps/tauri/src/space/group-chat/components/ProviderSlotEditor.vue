<template>
  <div class="slot-editor-overlay" @click.self="$emit('close')">
    <div class="slot-editor">
      <div class="editor-header">
        <h3>Provider 池管理</h3>
        <div class="header-actions">
          <button class="btn-guide" :class="{ active: !guideCollapsed }" @click="guideCollapsed = !guideCollapsed" title="使用说明">
            <WsIcon name="help" size="sm" />
          </button>
          <button class="btn-close" @click="$emit('close')"><WsIcon name="x" size="sm" /></button>
        </div>
      </div>

      <div v-if="!guideCollapsed" class="guide-panel">
        <div class="guide-step">
          <span class="guide-num">1</span>
          <span><b>创建池</b> — 输入名称（如"DeepSeek 池"），点击创建</span>
        </div>
        <div class="guide-step">
          <span class="guide-num">2</span>
          <span><b>添加条目</b> — 每个条目是一组 API 配置：</span>
        </div>
        <div class="guide-substeps">
          <div class="guide-substep"><span class="guide-tag cloud">云端</span>选择供应商+模型，可选填 API Key（留空则用全局配置）</div>
          <div class="guide-substep"><span class="guide-tag local">本地</span>填入端点 URL 和模型 ID（如 Ollama）</div>
          <div class="guide-substep"><span class="guide-tag custom">自定义</span>填入 API 端点、模型 ID 和 API Key</div>
        </div>
        <div class="guide-step">
          <span class="guide-num">3</span>
          <span><b>选择策略</b> — 轮询（依次使用）/ 加权随机 / 最少使用</span>
        </div>
        <div class="guide-step">
          <span class="guide-num">4</span>
          <span><b>Agent 绑定</b> — 创建/编辑群聊 Agent 时，Provider 来源选择对应池即可</span>
        </div>
        <div class="guide-tip">多 Key 分摊速率限制：同一供应商添加多个条目（不同 API Key），轮询策略自动分摊请求</div>
      </div>

      <div class="editor-body">
        <div v-if="profileStore.slots.length === 0" class="empty-hint">尚未创建 Provider 池，在下方创建</div>

        <div v-for="slot in profileStore.slots" :key="slot.id" class="slot-card">
          <div class="slot-header">
            <span class="slot-name">{{ slot.name }}</span>
            <select v-model="slot.strategy" class="strategy-select" @change="updateSlotStrategy(slot.id, slot.strategy)">
              <option value="round-robin">轮询</option>
              <option value="random">加权随机</option>
              <option value="least-recent">最少使用</option>
            </select>
            <button class="btn-delete" @click="profileStore.deleteSlot(slot.id)" title="删除池"><WsIcon name="trash" size="xs" /></button>
          </div>

          <div class="entry-list">
            <div v-for="entry in slot.entries" :key="entry.id" class="entry-row">
              <span class="entry-mode">{{ entry.mode }}</span>
              <span class="entry-model">{{ getModelName(entry.modelId) }}</span>
              <span class="entry-provider">{{ entry.provider || entry.baseUrl || '-' }}</span>
              <button class="btn-remove-entry" @click="profileStore.removeSlotEntry(slot.id, entry.id)" title="移除"><WsIcon name="x" size="xs" /></button>
            </div>

            <div class="add-entry-row">
              <select v-model="ensureEntry(slot.id).mode" class="entry-select" @change="onModeChange(slot.id)">
                <option value="cloud">云端</option>
                <option value="local">本地</option>
                <option value="custom">自定义</option>
              </select>

              <!-- 云端模式：可搜索的模型选择器 -->
              <template v-if="ensureEntry(slot.id).mode === 'cloud'">
                <div class="model-picker" :id="`picker-anchor-${slot.id}`">
                  <div class="picker-trigger" @click="togglePicker(slot.id)" :id="`picker-trigger-${slot.id}`">
                    <img v-if="ensureEntry(slot.id).provider && getProviderIconUrl(ensureEntry(slot.id).provider || '')" class="picker-icon" :src="getProviderIconUrl(ensureEntry(slot.id).provider || '')" alt="" />
                    <span class="picker-value" v-if="ensureEntry(slot.id).modelId">{{ getModelName(ensureEntry(slot.id).modelId) }}</span>
                    <span class="picker-placeholder" v-else>选择模型</span>
                    <WsIcon name="chevron-down" size="xs" />
                  </div>
                </div>
                <input
                  v-model="ensureEntry(slot.id).apiKey"
                  class="entry-input"
                  type="password"
                  placeholder="API Key（留空用全局）"
                />
              </template>

              <!-- 本地模式 -->
              <template v-if="ensureEntry(slot.id).mode === 'local'">
                <input v-model="ensureEntry(slot.id).baseUrl" class="entry-input" placeholder="端点 URL（如 http://localhost:11434）" />
                <input v-model="ensureEntry(slot.id).modelId" class="entry-input" placeholder="模型 ID" />
              </template>

              <!-- 自定义模式 -->
              <template v-if="ensureEntry(slot.id).mode === 'custom'">
                <input v-model="ensureEntry(slot.id).baseUrl" class="entry-input" placeholder="API 端点 URL" />
                <input v-model="ensureEntry(slot.id).modelId" class="entry-input" placeholder="模型 ID" />
                <input v-model="ensureEntry(slot.id).apiKey" class="entry-input" type="password" placeholder="API Key" />
              </template>

              <button class="btn-add-entry" @click="addEntry(slot.id)">添加</button>
            </div>
          </div>
        </div>

        <div class="create-slot">
          <div class="create-row">
            <input v-model="newSlotName" class="form-input" placeholder="池名称（如: 我的 OpenAI 池）" />
            <button class="btn-create" :disabled="!newSlotName.trim()" @click="createSlot">创建</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Teleport 下拉面板到 body，避免被外层 overflow 裁剪 -->
  <Teleport to="body">
    <div v-if="openPickerId" class="picker-backdrop" @click="closePicker"></div>
    <div v-if="openPickerId && pickerStyle" class="picker-dropdown" :style="pickerStyle">
      <input
        class="picker-search"
        v-model="searchQuery"
        placeholder="搜索模型..."
        @keydown.escape="closePicker"
        ref="searchInputRef"
      />
      <div class="picker-list">
        <div
          v-for="m in flatFilteredModels"
          :key="m.id"
          class="picker-item"
          :class="{ selected: currentEntry?.modelId === m.id }"
          @click="selectModel(m)"
        >
          <img v-if="getProviderIconUrl(m.provider)" class="picker-item-icon" :src="getProviderIconUrl(m.provider)" alt="" />
          <span class="picker-item-name">{{ m.name }}</span>
          <span class="picker-item-id">{{ m.id }}</span>
        </div>
        <div v-if="flatFilteredModels.length === 0" class="picker-empty">无匹配模型</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useAgentProfileStore } from '@/stores/agentProfileStore'
import { storeApiKey, getModelPresets, getModelInfo } from '@worldsmith/agent-runtime'
import { getProviderIconUrl } from '@/assets/providerIcons'
import type { LoadBalanceStrategy } from '@agent/group-chat/types'
import { WsIcon } from '@worldsmith/ui-kit'

defineEmits<{ close: [] }>()

const profileStore = useAgentProfileStore()
const modelPresets = getModelPresets()
const newSlotName = ref('')
const guideCollapsed = ref(false)
const newEntry = reactive<Record<string, { mode: string; modelId: string; provider?: string; baseUrl?: string; apiKey: string }>>({})
const openPickerId = ref<string | null>(null)
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const pickerStyle = ref<Record<string, string> | null>(null)

const EMPTY_ENTRY = { mode: 'cloud', modelId: '', provider: '', baseUrl: '', apiKey: '' }

// 扁平化模型列表（去掉分组标题）
interface FlatModel { id: string; name: string; provider: string }
const allFlatModels = computed<FlatModel[]>(() => {
  const list: FlatModel[] = []
  for (const g of modelPresets) {
    for (const m of g.models) {
      list.push({ id: m.id, name: m.name, provider: m.provider })
    }
  }
  return list
})

const flatFilteredModels = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return allFlatModels.value
  return allFlatModels.value.filter(m =>
    m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
  )
})

const currentEntry = computed(() => openPickerId.value ? newEntry[openPickerId.value] : null)

function ensureEntry(slotId: string) {
  if (!newEntry[slotId]) {
    newEntry[slotId] = { ...EMPTY_ENTRY }
  }
  return newEntry[slotId]
}

function getModelName(modelId: string): string {
  if (!modelId) return '-'
  const info = getModelInfo(modelId)
  return info?.name || modelId
}

function togglePicker(slotId: string): void {
  if (openPickerId.value === slotId) {
    closePicker()
  } else {
    openPickerId.value = slotId
    searchQuery.value = ''
    // 计算下拉面板定位
    nextTick(() => {
      const trigger = document.getElementById(`picker-trigger-${slotId}`)
      if (trigger) {
        const rect = trigger.getBoundingClientRect()
        const dropdownH = 320
        const spaceBelow = window.innerHeight - rect.bottom - 8
        const top = spaceBelow >= dropdownH
          ? rect.bottom + 4
          : Math.max(8, rect.top - dropdownH - 4)
        pickerStyle.value = {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${top}px`,
          width: `${Math.max(rect.width, 300)}px`,
        }
      } else {
        pickerStyle.value = null
      }
      searchInputRef.value?.focus()
    })
  }
}

function closePicker(): void {
  openPickerId.value = null
  searchQuery.value = ''
  pickerStyle.value = null
}

function selectModel(model: FlatModel): void {
  if (!openPickerId.value) return
  const entry = newEntry[openPickerId.value]
  if (!entry) return
  entry.modelId = model.id
  entry.provider = model.provider
  closePicker()
}

function onModeChange(slotId: string): void {
  const entry = newEntry[slotId]
  if (!entry) return
  entry.provider = ''
  entry.baseUrl = ''
  entry.modelId = ''
  closePicker()
}

function createSlot(): void {
  if (!newSlotName.value.trim()) return
  const slot = profileStore.createSlot({
    name: newSlotName.value.trim(),
    entries: [],
    strategy: 'round-robin',
  })
  newEntry[slot.id] = { ...EMPTY_ENTRY }
  newSlotName.value = ''
}

function updateSlotStrategy(slotId: string, strategy: string): void {
  profileStore.updateSlot(slotId, { strategy: strategy as LoadBalanceStrategy })
}

async function addEntry(slotId: string): Promise<void> {
  const entry = newEntry[slotId]
  if (!entry?.modelId) return
  if (entry.mode === 'cloud' && !entry.provider) return
  if (entry.mode === 'custom' && !entry.baseUrl) return
  const apiKeyId = entry.apiKey ? `slot:${slotId}:${Date.now()}` : undefined
  if (entry.apiKey && apiKeyId) {
    await storeApiKey(apiKeyId, entry.apiKey)
  }
  profileStore.addSlotEntry(slotId, {
    mode: entry.mode as any,
    modelId: entry.modelId,
    provider: entry.provider as any,
    baseUrl: entry.baseUrl,
    apiKeyId,
  })
  newEntry[slotId] = { ...EMPTY_ENTRY }
}

// 点击外部关闭 picker（backdrop 处理，无需 document listener）

onMounted(() => { /* no-op */ })
onUnmounted(() => { closePicker() })

for (const slot of profileStore.slots) {
  ensureEntry(slot.id)
}
</script>

<style scoped>
.slot-editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.slot-editor {
  width: 640px;
  max-height: 80vh;
  background: var(--color-surface-elevated);
  border-radius: 12px;
  border: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.editor-header h3 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--color-text);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-guide {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.btn-guide:hover {
  background: var(--color-surface);
  color: var(--color-primary);
}

.btn-guide.active {
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.btn-close {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.btn-close:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.editor-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-hint {
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--color-text-tertiary);
  padding: 16px 0;
}

/* 使用说明面板（header 下方展开） */
.guide-panel {
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-primary) 4%, var(--color-surface-elevated));
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.guide-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--fs-sm);
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.guide-num {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.guide-substeps {
  padding-left: 26px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.guide-substep {
  font-size: var(--fs-xs);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

.guide-tag {
  display: inline-block;
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  margin-right: 4px;
  vertical-align: middle;
}

.guide-tag.cloud {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
}

.guide-tag.local {
  background: color-mix(in srgb, #22c55e 15%, transparent);
  color: #22c55e;
}

.guide-tag.custom {
  background: color-mix(in srgb, #f59e0b 15%, transparent);
  color: #f59e0b;
}

.guide-tip {
  margin-top: 4px;
  padding: 6px 10px;
  border-radius: 4px;
  background: var(--color-surface);
  font-size: var(--fs-xs);
  color: var(--color-text-tertiary);
  line-height: 1.5;
}

.slot-card {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
}

.slot-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.slot-name {
  font-weight: 600;
  font-size: var(--fs-base);
  color: var(--color-text);
  flex: 1;
}

.strategy-select {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--fs-xs);
  outline: none;
}

.btn-delete {
  padding: 4px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.btn-delete:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.entry-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--color-surface);
  border-radius: 4px;
  font-size: var(--fs-sm);
  color: var(--color-text-secondary);
}

.entry-mode {
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}

.entry-model {
  font-weight: 500;
  flex: 1;
  color: var(--color-text);
}

.entry-provider {
  color: var(--color-text-tertiary);
  font-size: var(--fs-xs);
}

.btn-remove-entry {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.btn-remove-entry:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.add-entry-row {
  display: flex;
  gap: 6px;
  margin-top: 4px;
  flex-wrap: wrap;
  align-items: center;
}

.entry-select,
.entry-input {
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--fs-sm);
  flex: 1;
  min-width: 0;
  outline: none;
}

.entry-select:focus,
.entry-input:focus {
  border-color: var(--color-primary);
}

/* 可搜索模型选择器 */
.model-picker {
  position: relative;
  flex: 2;
  min-width: 160px;
}

.picker-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  min-height: 28px;
  transition: border-color 0.15s;
}

.picker-trigger:hover {
  border-color: var(--color-primary);
}

.picker-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 2px;
}

.picker-value {
  flex: 1;
  font-size: var(--fs-sm);
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-placeholder {
  flex: 1;
  font-size: var(--fs-sm);
  color: var(--color-text-tertiary);
}

/* Teleport 下拉面板（渲染到 body） */
.picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10001;
}

.picker-dropdown {
  position: fixed;
  max-height: 320px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 10002;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.picker-search {
  margin: 6px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--fs-sm);
  outline: none;
  flex-shrink: 0;
}

.picker-search:focus {
  border-color: var(--color-primary);
}

.picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 4px 4px;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
}

.picker-item:hover {
  background: var(--color-surface);
}

.picker-item.selected {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.picker-item-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 2px;
}

.picker-item-name {
  font-size: var(--fs-sm);
  color: var(--color-text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-item-id {
  font-size: 9px;
  color: var(--color-text-tertiary);
  font-family: monospace;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-empty {
  padding: 16px;
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--color-text-tertiary);
}

.btn-add-entry {
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--fs-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.btn-add-entry:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.create-slot {
  border-top: 1px solid var(--color-border);
  padding-top: 12px;
}

.create-row {
  display: flex;
  gap: 8px;
}

.form-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--fs-md);
  outline: none;
}

.form-input:focus {
  border-color: var(--color-primary);
}

.btn-create {
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  border: none;
  background: var(--color-primary);
  color: white;
  font-size: var(--fs-md);
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>