<template>
  <div class="model-switcher" :class="{ expanded: isExpanded }" ref="switcherRef">
    <button class="model-pill" @mousedown.prevent @click.stop="open = !open; if (open) updateDropdownPosition()">
      <img v-if="providerIconUrl" :src="providerIconUrl" class="model-pill-icon" alt="" />
      <span v-else class="model-pill-provider">{{ providerLabel }}</span>
      <span class="model-pill-name">{{ shortName }}</span>
      <span class="model-pill-arrow" :class="{ open }">▾</span>
    </button>
    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="open" class="model-dropdown-backdrop" @click="open = false"></div>
      </Transition>
      <Transition name="dropdown">
        <div v-if="open" class="model-dropdown" :style="dropdownStyle">
          <div class="dropdown-header">切换模型</div>
          <div v-for="group in dropdownGroups" :key="group.group" class="model-group">
            <div class="model-group-label">{{ group.group }}</div>
            <button
              v-for="m in group.models"
              :key="m.id"
              class="model-option"
              :class="{ active: m.id === currentModelId }"
              @click="selectModel(m.provider, m.id)"
            >
              <span class="model-option-status">{{ m.id === currentModelId ? '✓' : '' }}</span>
              <span class="model-option-name">{{ m.name }}</span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { getModelInfo, getModelPresets } from '../../agent/modelRegistry'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAgent } from '../../agent/composables/useAgent'
import { loadApiKey, hasApiKey } from '@agent/index'
import { getProviderIconUrl } from '../../assets/providerIcons'

const props = withDefaults(defineProps<{
  isExpanded?: boolean
}>(), {
  isExpanded: false,
})

const emit = defineEmits<{
  change: [provider: string, modelId: string]
}>()

const settingsStore = useSettingsStore()
const { updateModel } = useAgent()

const open = ref(false)
const switcherRef = ref<HTMLElement>()

const providerLabel = computed(() => {
  const labels: Record<string, string> = {
    anthropic: 'An', openai: 'OAI', google: 'GM', deepseek: 'DS',
    groq: 'GQ', zhipu: 'ZP', qwen: 'QW', minimax: 'MX', kimi: 'KM', agnes: 'AG',
  }
  const provider = settingsStore.aiProviderMode === 'cloud' ? settingsStore.aiCloudProvider : settingsStore.aiCustomType
  return labels[provider] || provider.slice(0, 2).toUpperCase()
})

const providerIconUrl = computed(() => {
  const provider = settingsStore.aiProviderMode === 'cloud' ? settingsStore.aiCloudProvider : ''
  return provider ? getProviderIconUrl(provider) : ''
})

const currentModelId = computed(() => {
  if (settingsStore.aiProviderMode === 'cloud') return settingsStore.aiCloudModel
  if (settingsStore.aiProviderMode === 'local') return settingsStore.aiLocalModel
  return settingsStore.aiCustomModel
})

const shortName = computed(() => {
  const id = currentModelId.value
  const info = getModelInfo(id)
  if (info) {
    const n = info.name
    return n.length > 16 ? n.slice(0, 14) + '…' : n
  }
  return id.length > 20 ? id.slice(0, 18) + '…' : id
})

const dropdownStyle = ref<Record<string, string>>({ top: '0px', left: '0px' })
const dropdownGroups = ref<{ group: string; models: { id: string; name: string; provider: string }[] }[]>([])

async function updateDropdownPosition() {
  if (!switcherRef.value) return
  const rect = switcherRef.value.getBoundingClientRect()
  dropdownStyle.value = {
    bottom: `${window.innerHeight - rect.top + 6}px`,
    left: `${Math.max(8, rect.left + rect.width / 2 - 100)}px`,
  }
  const allGroups = getModelPresets()
  const filtered: typeof allGroups = []
  for (const group of allGroups) {
    const providerKey = group.models[0]?.provider
    if (providerKey && await hasApiKey(providerKey)) {
      filtered.push(group)
    }
  }
  dropdownGroups.value = filtered
}

async function selectModel(provider: string, modelId: string) {
  open.value = false
  if (modelId === currentModelId.value) return

  const info = getModelInfo(modelId)
  const contextWindow = info?.contextLength || 128000
  const maxOut = info?.maxOutputTokens || 8192

  if (settingsStore.aiProviderMode === 'cloud') {
    settingsStore.aiCloudProvider = provider as any
    settingsStore.aiCloudModel = modelId
  } else if (settingsStore.aiProviderMode === 'local') {
    settingsStore.aiLocalModel = modelId
  } else {
    settingsStore.aiCustomModel = modelId
  }

  const apiKey = await loadApiKey(provider)
  await updateModel(provider, modelId, undefined, apiKey || undefined, undefined, maxOut, contextWindow)
  try {
    localStorage.setItem('agent_current_model', JSON.stringify({ provider, modelId, contextLength: contextWindow }))
  } catch {}
  emit('change', provider, modelId)
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  const target = e.target as HTMLElement
  if (switcherRef.value && !switcherRef.value.contains(target) && !target.closest('.model-dropdown')) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})
</script>

<style scoped>
.model-switcher {
  flex-shrink: 0;
  position: relative;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.model-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 24px;
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s, transform 0.2s, opacity 0.2s, filter 0.2s;
  height: 32px;
}

.model-pill:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.model-pill-provider {
  font-weight: 600;
  color: var(--color-primary);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.02em;
}

.model-pill-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex-shrink: 0;
}

.model-pill-name {
  font-weight: 500;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-pill-arrow {
  font-size: 9px;
  opacity: 0.5;
  margin-left: 2px;
  transition: transform 0.2s;
}
.model-pill-arrow.open {
  transform: rotate(180deg);
}

.model-dropdown-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

.model-dropdown {
  position: fixed;
  min-width: 200px;
  max-height: 70vh;
  overflow-y: auto;
  background: rgba(10, 10, 20, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  padding: 6px;
  z-index: 10001;
}

.dropdown-header {
  padding: 6px 10px 4px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 4px;
}

.model-group {
  margin-bottom: 2px;
}

.model-group-label {
  padding: 4px 10px 2px;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  transition: background 0.12s;
}

.model-option:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

.model-option.active {
  background: var(--color-primary-muted);
  color: var(--color-text);
}

.model-option-status {
  width: 14px;
  font-size: var(--font-size-xs);
  color: var(--color-primary);
  flex-shrink: 0;
}

.model-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-enter-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-leave-active {
  transition: opacity 0.08s ease, transform 0.08s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
</style>
