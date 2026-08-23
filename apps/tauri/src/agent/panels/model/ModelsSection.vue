<template>
  <div class="models-section">
    <!-- ── 供应商类型平铺（云端 API / 本地模型 / 第三方自定义） ── -->
    <div class="ms-types">
      <button
        v-for="t in TYPE_TILES"
        :key="t.mode"
        class="ms-type"
        :class="{ on: settingsStore.aiProviderMode === t.mode }"
        @click="emit('open-type', t.mode)"
      >
        <span class="ms-type-icon"><WsIcon :name="t.icon" size="md" /></span>
        <span class="ms-type-label">{{ t.label }}</span>
        <span class="ms-type-desc">{{ t.desc }}</span>
      </button>
    </div>

    <!-- ── 可用模型：分类栏 + 列表 ── -->
    <div class="ms-models">
      <div class="agent-set-sub">可用模型</div>
      <div class="ms-cat-bar" role="tablist" :aria-label="'可用模型分类'">
        <button
          v-for="m in MODALITY_ORDER"
          :key="m"
          class="ms-cat"
          :class="{ on: activeCat === m }"
          role="tab"
          :aria-selected="activeCat === m"
          @click="setCat(m)"
        >{{ MODALITY_LABELS[m] }}<span class="ms-cat-count">{{ groupOf(m).length }}</span></button>
      </div>
      <div v-if="savedModels.length" class="ms-model-grid">
        <button
          v-for="m in savedModelsOfCat(activeCat)"
          :key="m.id"
          class="ms-model-card"
          :class="{ active: isActiveModel(m) }"
          @click="emit('open-model', { id: m.modelId, name: m.name })"
        >
          <ProviderLogo :provider="m.providerId" :label="m.providerLabel" :size="26" />
          <span class="ms-model-card-name">{{ m.name }}</span>
          <span class="ms-model-card-id">{{ m.providerLabel }} · {{ m.modelId }}</span>
        </button>
      </div>
      <div v-else class="ms-empty">尚无已保存模型，请先在上方配置</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useSettingsStore } from '@/stores/settingsStore'
import ProviderLogo from './ProviderLogo.vue'
import { MODALITY_LABELS, MODALITY_ORDER, getModelInfoById } from './model-classify'
import type { ModelModality } from './model-classify'
import { loadSavedModels, type SavedModel as PersistedSavedModel } from './savedModels'

defineProps<{}>()

const emit = defineEmits<{
  'open-type': [mode: 'cloud' | 'local' | 'custom']
  'open-model': [model: AvailableModelView]
}>()

interface AvailableModelView { id: string; name: string }
interface SavedModel {
  id: string
  providerId: string
  providerLabel: string
  modelId: string
  name: string
  modality: ModelModality
}

const settingsStore = useSettingsStore()

const TYPE_TILES = [
  { mode: 'cloud' as const, icon: 'globe', label: '云端 API', desc: '官方/聚合/应用云端供应商' },
  { mode: 'local' as const, icon: 'monitor', label: '本地模型', desc: 'Ollama / LM Studio / vLLM' },
  { mode: 'custom' as const, icon: 'link', label: '第三方自定义', desc: 'OpenAI / Anthropic 兼容端点' },
]

const PROVIDER_LABEL: Record<string, string> = {
  cloud: '云端', local: '本地', custom: '自定义',
}

/** 独立持久化「已保存模型」集合为权威源；集合为空时回退到「当前已配置模型」合成（避免首次空态） */
const savedModels = computed<SavedModel[]>(() => {
  const persisted = loadSavedModels()
  if (persisted.length > 0) {
    return persisted.map((p) => ({ ...p, modality: resolveModality(p) }))
  }
  return synthesizeSaved()
})

function resolveModality(p: PersistedSavedModel): ModelModality {
  const info = getModelInfoById()[p.modelId]
  return (info?.modality as ModelModality) || (p.modality as ModelModality) || 'text'
}

/** 集合为空时的兜底合成：云端当前 + 本地当前 + 已加自定义供应商 */
function synthesizeSaved(): SavedModel[] {
  const list: SavedModel[] = []
  const infoById = getModelInfoById()
  const cloudProvider = settingsStore.aiCloudProvider
  const cloudModel = settingsStore.aiCloudModel
  if (cloudModel) {
    list.push({
      id: `cloud-${cloudProvider}-${cloudModel}`,
      providerId: cloudProvider,
      providerLabel: PROVIDER_LABEL.cloud,
      modelId: cloudModel,
      name: infoById[cloudModel]?.name || cloudModel,
      modality: infoById[cloudModel]?.modality || 'text',
    })
  }
  if (settingsStore.aiLocalModel) {
    const m = settingsStore.aiLocalModel
    list.push({
      id: `local-${m}`,
      providerId: 'ollama',
      providerLabel: PROVIDER_LABEL.local,
      modelId: m,
      name: m,
      modality: 'text',
    })
  }
  for (const cp of settingsStore.customProviders) {
    if (!cp.modelId) continue
    list.push({
      id: `custom-${cp.id}`,
      providerId: 'custom',
      providerLabel: PROVIDER_LABEL.custom,
      modelId: cp.modelId,
      name: cp.name || cp.modelId,
      modality: 'text',
    })
  }
  return list
}

const activeCat = ref<ModelModality>('text')
function setCat(m: ModelModality): void { activeCat.value = m }

function savedModelsOfCat(m: ModelModality): SavedModel[] {
  return savedModels.value.filter((x) => x.modality === m)
}
function groupOf(m: ModelModality): SavedModel[] {
  return savedModelsOfCat(m)
}

function isActiveModel(model: SavedModel): boolean {
  if (settingsStore.aiProviderMode === 'cloud' && model.providerId === settingsStore.aiCloudProvider) {
    return settingsStore.aiCloudModel === model.modelId
  }
  if (settingsStore.aiProviderMode === 'local') return settingsStore.aiLocalModel === model.modelId
  return settingsStore.aiCustomModel === model.modelId
}
</script>

<style scoped>
.models-section { display: flex; flex-direction: column; gap: 12px; }
.ms-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
@media (max-width: 480px) { .ms-types { grid-template-columns: 1fr; } }
.ms-type {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; text-align: left; cursor: pointer;
  border-radius: var(--radius-mid, 8px);
  border: 1px solid var(--color-border, var(--agent-border));
  background: var(--color-surface, var(--agent-hover-bg));
  transition: border-color 0.15s, background 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}
.ms-type:hover { border-color: var(--color-primary); color: var(--color-text); }
.ms-type.on {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  box-shadow: 0 0 0 1px var(--color-primary) inset;
}
.ms-type-icon { display: flex; color: var(--color-text-secondary); }
.ms-type.on .ms-type-icon { color: var(--color-primary); }
.ms-type-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text); }
.ms-type-desc { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-left: auto; white-space: nowrap; }

.ms-cat-bar { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.ms-cat {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: var(--radius-pill, 999px);
  border: 1px solid var(--color-border, var(--agent-border));
  background: var(--color-surface, var(--agent-hover-bg));
  color: var(--color-text-secondary); font-size: var(--font-size-xs);
  cursor: pointer; transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.ms-cat:hover { color: var(--color-text); }
.ms-cat.on { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
.ms-cat-count { font-size: var(--font-size-2xs, 10px); opacity: 0.7; }

.ms-model-list { display: flex; flex-direction: column; gap: 4px; }
.ms-model-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
@media (max-width: 480px) { .ms-model-grid { grid-template-columns: 1fr; } }
.ms-model-card {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 6px; text-align: center; cursor: pointer;
  border: 1px solid var(--color-border, var(--agent-border));
  border-radius: 10px; background: var(--color-surface, var(--agent-hover-bg));
  transition: border-color 0.15s, background 0.15s;
}
.ms-model-card:hover { border-color: var(--color-primary); }
.ms-model-card.active { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
.ms-model-card-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text); }
.ms-model-card-id { font-size: var(--font-size-2xs, 10px); color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ms-model-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 9px; border-radius: var(--radius-mid, 8px);
  border: 1px solid transparent; background: var(--color-surface, var(--agent-hover-bg));
  text-align: left; cursor: pointer; transition: border-color 0.15s, background 0.15s;
}
.ms-model-item:hover { border-color: var(--color-border, var(--agent-border)); }
.ms-model-item.active { border-color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 12%, transparent); }
.ms-model-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text); }
.ms-model-id { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-model-edit {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border: none; background: transparent;
  color: var(--color-text-tertiary); cursor: pointer; border-radius: var(--radius-sm, 6px);
  opacity: 0; transition: opacity 0.15s, color 0.15s;
}
.ms-model-item:hover .ms-model-edit { opacity: 1; }
.ms-model-edit:hover { color: var(--color-primary); }
.ms-empty { font-size: var(--font-size-xs); color: var(--color-text-tertiary); padding: 8px 0; }
</style>