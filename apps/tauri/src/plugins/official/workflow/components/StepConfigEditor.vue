<template>
  <div class="sce">
    <!-- agent-task -->
    <template v-if="stepType === 'agent-task'">
      <label class="sce-label">任务描述 / Prompt</label>
      <textarea class="sce-textarea" :value="localCfg.prompt" @input="setField('prompt', ($event.target as HTMLTextAreaElement).value)" rows="3" placeholder="描述 Agent 要执行的创作任务..." />
      <label class="sce-label">目标实体类型</label>
      <select class="sce-select" :value="localCfg.targetEntityType" @change="setField('targetEntityType', ($event.target as HTMLSelectElement).value)">
        <option value="">（无）</option>
        <option v-for="et in entityTypes" :key="et.key" :value="et.key">{{ et.label }}</option>
      </select>
      <label class="sce-label">绑定技能 <span class="sce-hint">逗号分隔</span></label>
      <input class="sce-input" :value="skillIdsText" @input="onSkillIdsInput" placeholder="如 worldbuilding, content-craft" />
      <label class="sce-label">预期输出</label>
      <input class="sce-input" :value="localCfg.expectedOutput" @input="setField('expectedOutput', ($event.target as HTMLInputElement).value)" placeholder="如 3个角色档案" />
    </template>

    <!-- user-review -->
    <template v-else-if="stepType === 'user-review'">
      <label class="sce-label">审阅提示</label>
      <textarea class="sce-textarea" :value="localCfg.instruction" @input="setField('instruction', ($event.target as HTMLTextAreaElement).value)" rows="2" placeholder="告诉用户需要审阅什么..." />
      <label class="sce-checkbox-label">
        <input type="checkbox" :checked="localCfg.skippable" @change="setField('skippable', ($event.target as HTMLInputElement).checked)" />
        允许跳过
      </label>
    </template>

    <!-- batch-create -->
    <template v-else-if="stepType === 'batch-create'">
      <label class="sce-label">实体类型</label>
      <select class="sce-select" :value="localCfg.entityType" @change="setField('entityType', ($event.target as HTMLSelectElement).value)">
        <option v-for="et in entityTypes" :key="et.key" :value="et.key">{{ et.label }}</option>
      </select>
      <label class="sce-label">创建数量</label>
      <input class="sce-input" type="number" :value="localCfg.count" @input="setField('count', parseInt(($event.target as HTMLInputElement).value, 10) || 1)" min="1" />
      <label class="sce-label">参考上下文</label>
      <textarea class="sce-textarea" :value="localCfg.context" @input="setField('context', ($event.target as HTMLTextAreaElement).value)" rows="2" placeholder="提供创建的上下文背景..." />
      <label class="sce-label">名称前缀</label>
      <input class="sce-input" :value="localCfg.namePrefix" @input="setField('namePrefix', ($event.target as HTMLInputElement).value)" placeholder="如 诺恩王国-" />
    </template>

    <!-- template-apply -->
    <template v-else-if="stepType === 'template-apply'">
      <label class="sce-label">选择模板</label>
      <select class="sce-select" :value="localCfg.templateId" @change="setField('templateId', ($event.target as HTMLSelectElement).value)">
        <option value="">（请选择）</option>
        <option v-for="tpl in allTemplates" :key="tpl.id" :value="tpl.id">{{ tpl.name }} — {{ tpl.description }}</option>
      </select>
      <label class="sce-label">覆盖参数 <span class="sce-hint">JSON 格式</span></label>
      <textarea class="sce-textarea" :value="overridesText" @input="onOverridesInput" rows="2" placeholder='{"name": "xxx"}' />
    </template>

    <!-- consistency-check -->
    <template v-else-if="stepType === 'consistency-check'">
      <label class="sce-label">检查范围</label>
      <select class="sce-select" :value="localCfg.scope" @change="setField('scope', ($event.target as HTMLSelectElement).value)">
        <option value="all">全部内容</option>
        <option value="recent">最近创建</option>
      </select>
      <label class="sce-label">严格度</label>
      <select class="sce-select" :value="localCfg.strictness" @change="setField('strictness', ($event.target as HTMLSelectElement).value)">
        <option value="loose">宽松</option>
        <option value="normal">标准</option>
        <option value="strict">严格</option>
      </select>
    </template>

    <!-- transform -->
    <template v-else-if="stepType === 'transform'">
      <label class="sce-label">转换描述</label>
      <textarea class="sce-textarea" :value="localCfg.description" @input="setField('description', ($event.target as HTMLTextAreaElement).value)" rows="2" placeholder="描述要做的转换..." />
      <label class="sce-label">转换规则</label>
      <textarea class="sce-textarea" :value="localCfg.rules" @input="setField('rules', ($event.target as HTMLTextAreaElement).value)" rows="3" placeholder="自然语言描述转换规则..." />
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch, ref, computed, onMounted } from 'vue'
import type { StepType, StepConfig, AgentTaskConfig, TemplateApplyConfig } from '../types'
import { usePipelineTemplates } from '../composables/usePipelineTemplates'

const props = defineProps<{
  stepType: StepType
  config: StepConfig
}>()

const emit = defineEmits<{
  'update:config': [config: StepConfig]
}>()

// 本地响应式副本
const localCfg = reactive<Record<string, any>>({ ...props.config })

// 当 props.config 变化时同步到本地
watch(() => props.config, (newCfg) => {
  Object.keys(localCfg).forEach(k => delete localCfg[k])
  Object.assign(localCfg, newCfg)
}, { deep: true })

/** 修改单个字段并 emit */
function setField(field: string, value: any) {
  localCfg[field] = value
  emit('update:config', { ...localCfg } as StepConfig)
}

// skillIds 用逗号分隔文本
const skillIdsText = computed(() => {
  return (props.config as AgentTaskConfig).skillIds?.join(', ') ?? ''
})

function onSkillIdsInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  const ids = val.split(',').map(s => s.trim()).filter(Boolean)
  localCfg.skillIds = ids
  emit('update:config', { ...localCfg, skillIds: ids } as StepConfig)
}

// overrides 用 JSON 文本
const overridesText = computed(() => {
  const overrides = (props.config as TemplateApplyConfig).overrides
  try { return overrides ? JSON.stringify(overrides, null, 2) : '{}' }
  catch { return '{}' }
})

function onOverridesInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  try {
    const parsed = JSON.parse(val)
    localCfg.overrides = parsed
    emit('update:config', { ...localCfg, overrides: parsed } as StepConfig)
  } catch {
    // 等 JSON 合法后再更新
  }
}

// ─── 下拉选择数据 ──────────────────────────────────────────
const { allTemplates } = usePipelineTemplates()

/** 可选实体类型（内置 + 后端注册） */
const entityTypes = ref<{ key: string; label: string }[]>([
  { key: 'character', label: '角色 (character)' },
  { key: 'region', label: '区域 (region)' },
  { key: 'faction', label: '势力 (faction)' },
  { key: 'event', label: '事件 (event)' },
  { key: 'item', label: '物品 (item)' },
  { key: 'knowledge', label: '知识 (knowledge)' },
])

// 从后端 schema 加载已注册的实体类型
onMounted(async () => {
  try {
    const { schemaListEntityTypes } = await import('@/core/coreBackend')
    const schemas = await schemaListEntityTypes()
    if (schemas?.length) {
      const existing = new Set(entityTypes.value.map(e => e.key))
      for (const s of schemas) {
        if (!existing.has(s.typeKey)) {
          entityTypes.value.push({ key: s.typeKey, label: `${s.label} (${s.typeKey})` })
        }
      }
    }
  } catch {
    // 核心后端不可用时使用内置列表
  }
})
</script>

<style scoped>
.sce { display: flex; flex-direction: column; gap: 6px; }
.sce-label { font-size: 12px; font-weight: 500; color: var(--text-secondary, #8b949e); margin-top: 4px; }
.sce-hint { font-weight: normal; opacity: 0.6; font-style: italic; }
.sce-input, .sce-select {
  padding: 5px 8px; border-radius: 5px; border: 1px solid var(--border, #30363d);
  background: var(--bg-secondary, #161b22); color: var(--text-primary, #e6edf3);
  font-size: 12px; outline: none;
}
.sce-input:focus, .sce-select:focus, .sce-textarea:focus {
  border-color: var(--primary, #58a6ff);
}
.sce-textarea {
  padding: 6px 8px; border-radius: 5px; border: 1px solid var(--border, #30363d);
  background: var(--bg-secondary, #161b22); color: var(--text-primary, #e6edf3);
  font-size: 12px; outline: none; resize: vertical; font-family: inherit;
}
.sce-checkbox-label {
  display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer;
  color: var(--text-primary, #e6edf3);
}
.sce-checkbox-label input[type="checkbox"] {
  accent-color: var(--primary, #58a6ff);
}
</style>
