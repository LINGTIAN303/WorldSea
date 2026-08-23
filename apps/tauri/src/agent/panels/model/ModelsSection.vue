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
      <div v-if="currentModels.length" class="ms-model-list">
        <button
          v-for="model in groupOf(activeCat)"
          :key="model.id"
          class="ms-model-item"
          :class="{ active: isActiveModel(model) }"
          @click="emit('open-model', model)"
        >
          <span class="ms-model-name">{{ model.name }}</span>
          <span class="ms-model-id">{{ model.id }}</span>
          <button
            class="ms-model-edit"
            type="button"
            :aria-label="`编辑 ${model.name}`"
            title="编辑模型参数"
            @click.stop="emit('open-model', model)"
          ><WsIcon name="edit" size="xs" /></button>
        </button>
      </div>
      <div v-else class="ms-empty">当前模式暂无可用模型，请先在上方选择供应商类型</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  getAvailableModels, MODALITY_LABELS, MODALITY_ORDER,
  type ModelModality, type AvailableModelView,
} from './model-classify'

defineProps<{}>()

const emit = defineEmits<{
  'open-type': [mode: 'cloud' | 'local' | 'custom']
  'open-model': [model: AvailableModelView]
}>()

const settingsStore = useSettingsStore()

const TYPE_TILES = [
  { mode: 'cloud' as const, icon: 'globe', label: '云端 API', desc: '官方/聚合/应用云端供应商' },
  { mode: 'local' as const, icon: 'monitor', label: '本地模型', desc: 'Ollama / LM Studio / vLLM' },
  { mode: 'custom' as const, icon: 'link', label: '第三方自定义', desc: 'OpenAI / Anthropic 兼容端点' },
]

// 当前模式的模型：cloud=当前云供应商模型的按模态分组；local/custom=手动模型列表（暂用注册表全量兜底）
const currentModels = computed<AvailableModelView[]>(() => {
  if (settingsStore.aiProviderMode === 'cloud') {
    const provider = settingsStore.aiCloudProvider
    const seen = new Map<string, AvailableModelView>()
    for (const m of getAvailableModels(provider)) seen.set(m.id, m)
    return Array.from(seen.values())
  }
  // local/custom：无注册表，返回注册表全量供浏览（带真实分类）
  return getAvailableModels()
})

const activeCat = ref<ModelModality>('text')
function setCat(m: ModelModality): void { activeCat.value = m }

function groupOf(m: ModelModality): AvailableModelView[] {
  return currentModels.value.filter((x) => x.modality === m)
}

function isActiveModel(model: AvailableModelView): boolean {
  if (settingsStore.aiProviderMode === 'cloud') {
    return settingsStore.aiCloudModel === model.id
  }
  if (settingsStore.aiProviderMode === 'local') return settingsStore.aiLocalModel === model.id
  return settingsStore.aiCustomModel === model.id
}
</script>

<style scoped>
.models-section { display: flex; flex-direction: column; gap: 12px; }
.ms-types { display: grid; grid-template-columns: 1fr; gap: 8px; }
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