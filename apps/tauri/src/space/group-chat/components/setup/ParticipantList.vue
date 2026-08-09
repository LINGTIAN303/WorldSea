<template>
  <div class="participant-list">
    <div
      v-for="(p, i) in modelValue"
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
        <button class="pc-remove" @click="removeParticipant(i)" :disabled="modelValue.length <= 2"><WsIcon name="x" size="xs" /></button>
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
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { getModelInfo } from '@worldsmith/agent-runtime'
import { FallbackChainImpl } from '../../FallbackChain'
import type { ModelHealthResult } from '../../types'
import ModelFlyoutSelect from '../ModelFlyoutSelect.vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { PARTICIPANT_COLOR_PALETTE, type ParticipantDraft } from './types'

/**
 * 参与者列表组件
 *
 * 通过 v-model 双向绑定 participants 数组（直接修改数组元素属性，
 * 父组件持有的引用不变，符合 Vue 单向数据流的边界）。
 * 健康检查逻辑封装在组件内部。
 */
const modelValue = defineModel<ParticipantDraft[]>({ required: true })

const fallbackChain = new FallbackChainImpl()
const healthResults = ref<Record<number, ModelHealthResult>>({})

function isDuplicateName(idx: number): boolean {
  const arr = modelValue.value
  const name = arr[idx]?.name?.trim()
  if (!name) return false
  return arr.some((p, i) => i !== idx && p.name.trim() === name)
}

function cycleColor(idx: number): void {
  const arr = modelValue.value
  const current = arr[idx].color
  const ci = PARTICIPANT_COLOR_PALETTE.indexOf(current)
  arr[idx].color = PARTICIPANT_COLOR_PALETTE[(ci + 1) % PARTICIPANT_COLOR_PALETTE.length]
}

function removeParticipant(idx: number): void {
  modelValue.value.splice(idx, 1)
}

function onModelChange(idx: number, modelId: string): void {
  modelValue.value[idx].modelId = modelId
  delete healthResults.value[idx]
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
  const p = modelValue.value[idx]
  if (!p) return
  healthResults.value[idx] = {
    status: 'unknown' as ModelHealthResult['status'],
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

function getFallbackChainDisplay(idx: number): { id: string; name: string; isCurrent: boolean }[] {
  const p = modelValue.value[idx]
  if (!p) return []
  return fallbackChain.getChainDisplay(p.modelId)
}
</script>

<style scoped>
.participant-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.participant-card {
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
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
  font-size: var(--fs-sm);
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
</style>