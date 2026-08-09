<template>
  <div class="model-flyout" ref="flyoutRef">
    <button class="flyout-trigger" @click="toggleOpen">
      <span class="trigger-name">{{ currentModelName }}</span>
      <span class="trigger-ctx">{{ currentModelCtx }}</span>
      <span class="trigger-arrow" :class="{ open: isOpen }">▾</span>
    </button>

    <Teleport to="body">
      <div v-if="isOpen" class="flyout-backdrop" @click="close"></div>
      <Transition name="flyout">
        <div v-if="isOpen" class="flyout-panel" :style="panelStyle">
          <div class="flyout-providers">
            <div
              v-for="group in modelPresets"
              :key="group.group"
              class="provider-item"
              :class="{ active: activeProvider === group.models[0]?.provider }"
              @mouseenter="onProviderHover(group.models[0]?.provider)"
              @click="onProviderClick(group.models[0]?.provider)"
            >
              <span
                class="provider-dot"
                :style="{ background: PROVIDER_COLORS[group.models[0]?.provider] || '#6b7280' }"
              ></span>
              <span class="provider-name">{{ group.group }}</span>
              <span class="provider-arrow">›</span>
            </div>
          </div>
          <Transition name="flyout-sub">
            <div v-if="activeProvider" class="flyout-models" @mouseenter="onModelsEnter" @mouseleave="onModelsLeave">
              <div class="models-header">{{ activeProviderGroup?.group }}</div>
              <div
                v-for="m in activeProviderGroup?.models"
                :key="m.id"
                class="model-item"
                :class="{ current: m.id === modelId }"
                @click="selectModel(m.id)"
              >
                <span class="model-name">{{ m.name }}</span>
                <span class="model-ctx">{{ formatCtx(m.id) }}</span>
                <span v-if="isFreeModel(m.id)" class="model-free">🆓</span>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getModelPresets, getModelInfo } from '@worldsmith/agent-runtime'

const props = defineProps<{ modelId: string }>()
const emit = defineEmits<{ 'update:modelId': [value: string] }>()

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#d97706',
  openai: '#10b981',
  google: '#3b82f6',
  deepseek: '#6366f1',
  groq: '#f59e0b',
  zhipu: '#ef4444',
  qwen: '#8b5cf6',
  minimax: '#ec4899',
  kimi: '#06b6d4',
}

const modelPresets = getModelPresets()

const flyoutRef = ref<HTMLElement | null>(null)
const isOpen = ref(false)
const hoveredProvider = ref<string | null>(null)
const pinnedProvider = ref<string | null>(null)

const activeProvider = computed(() => pinnedProvider.value || hoveredProvider.value)

const activeProviderGroup = computed(() =>
  modelPresets.find(g => g.models[0]?.provider === activeProvider.value),
)

const currentModelName = computed(() => getModelInfo(props.modelId)?.name || props.modelId)

const currentModelCtx = computed(() => formatCtx(props.modelId))

function formatCtx(modelId: string): string {
  const info = getModelInfo(modelId)
  if (!info) return ''
  const len = info.contextLength
  if (len >= 1_000_000) return `${Math.round(len / 1_000_000)}M`
  return `${Math.round(len / 1_000)}K`
}

function isFreeModel(modelId: string): boolean {
  const info = getModelInfo(modelId)
  if (!info) return false
  return info.inputPricePerMillion === 0 && info.outputPricePerMillion === 0
}

const panelStyle = computed(() => {
  if (!flyoutRef.value) return {}
  const rect = flyoutRef.value.getBoundingClientRect()
  const panelWidth = 180 + 220
  let left = rect.left
  if (left + panelWidth > window.innerWidth) {
    left = window.innerWidth - panelWidth - 8
  }
  if (left < 8) left = 8
  let top = rect.bottom + 4
  if (top + 360 > window.innerHeight) {
    top = rect.top - 360 - 4
  }
  return {
    position: 'fixed' as const,
    left: `${left}px`,
    top: `${top}px`,
    zIndex: 9999,
  }
})

function toggleOpen() {
  isOpen.value ? close() : (isOpen.value = true)
}

function onProviderHover(provider: string | undefined) {
  if (!provider) return
  if (!pinnedProvider.value) {
    hoveredProvider.value = provider
  }
}

function onProviderClick(provider: string | undefined) {
  if (!provider) return
  if (pinnedProvider.value === provider) {
    pinnedProvider.value = null
    hoveredProvider.value = provider
  } else {
    pinnedProvider.value = provider
  }
}

function onModelsEnter() {}

function onModelsLeave() {
  if (!pinnedProvider.value) {
    hoveredProvider.value = null
  }
}

function selectModel(id: string) {
  emit('update:modelId', id)
  close()
}

function close() {
  isOpen.value = false
  hoveredProvider.value = null
  pinnedProvider.value = null
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.model-flyout {
  position: relative;
  display: inline-block;
}

.flyout-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 4px 10px;
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: var(--radius-sm);
  background: var(--color-surface, #fff);
  cursor: pointer;
  font-size: var(--fs-md);
  line-height: 1.4;
  color: var(--color-text, #111827);
  white-space: nowrap;
  overflow: hidden;
}

.flyout-trigger:hover {
  border-color: var(--color-primary, #6366f1);
}

.trigger-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.trigger-ctx {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--color-text-muted, #9ca3af);
}

.trigger-arrow {
  flex-shrink: 0;
  margin-left: auto;
  transition: transform 0.2s;
  font-size: var(--fs-sm);
}

.trigger-arrow.open {
  transform: rotate(180deg);
}
</style>

<style>
.flyout-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}

.flyout-panel {
  display: flex;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: var(--radius-mid);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.flyout-providers {
  width: 180px;
  max-height: 360px;
  overflow-y: auto;
  border-right: 1px solid var(--color-border, #e5e7eb);
}

.provider-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: var(--fs-md);
  color: var(--color-text, #111827);
  transition: background 0.15s;
}

.provider-item:hover,
.provider-item.active {
  background: var(--color-primary-muted, #eef2ff);
}

.provider-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.provider-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-arrow {
  flex-shrink: 0;
  color: var(--color-text-muted, #9ca3af);
  font-size: var(--fs-base);
}

.flyout-models {
  width: 220px;
  max-height: 360px;
  overflow-y: auto;
}

.models-header {
  padding: 8px 12px 4px;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--color-text-muted, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: var(--fs-md);
  color: var(--color-text, #111827);
  transition: background 0.15s;
}

.model-item:hover {
  background: var(--color-surface, #f9fafb);
}

.model-item.current {
  background: var(--color-primary-muted, #eef2ff);
}

.model-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-ctx {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  color: var(--color-text-muted, #9ca3af);
}

.model-free {
  flex-shrink: 0;
  font-size: var(--fs-xs);
}

.flyout-enter-active,
.flyout-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.flyout-enter-from,
.flyout-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.flyout-sub-enter-active,
.flyout-sub-leave-active {
  transition: opacity 0.15s;
}

.flyout-sub-enter-from,
.flyout-sub-leave-to {
  opacity: 0;
}
</style>