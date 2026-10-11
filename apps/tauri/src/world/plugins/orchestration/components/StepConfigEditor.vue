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

    <!-- tot-search（思维树探索，B 轨 TotNode；由主 Agent 直接执行，不派生子 Agent） -->
    <template v-else-if="stepType === 'tot-search'">
      <label class="sce-label">任务意图</label>
      <textarea class="sce-textarea" :value="localCfg.intent" @input="setField('intent', ($event.target as HTMLTextAreaElement).value)" rows="2" placeholder="要探索/择优的创作目标，如：为故事设计 3 个结局方向并选出最优" />
      <label class="sce-label">展开器提示词 <span class="sce-hint">生成候选项的系统提示</span></label>
      <textarea class="sce-textarea" :value="localCfg.expandPrompt" @input="setField('expandPrompt', ($event.target as HTMLTextAreaElement).value)" rows="3" placeholder="如何基于当前分支生成候选细化方案..." />
      <label class="sce-label">评分器提示词 <span class="sce-hint">独立评分，避免自我偏好</span></label>
      <textarea class="sce-textarea" :value="localCfg.evaluatePrompt" @input="setField('evaluatePrompt', ($event.target as HTMLTextAreaElement).value)" rows="3" placeholder="如何对候选方案打 0-100 分..." />
      <label class="sce-label">分支数 k <span class="sce-hint">每叶子展开候选数</span></label>
      <input class="sce-input" type="number" :value="localCfg.branchingK" @input="setField('branchingK', num('branchingK'))" min="1" max="8" />
      <label class="sce-label">保留宽度 top-b <span class="sce-hint">剪枝后保留的候选数</span></label>
      <input class="sce-input" type="number" :value="localCfg.keepTopB" @input="setField('keepTopB', num('keepTopB'))" min="1" max="4" />
      <label class="sce-label">树深上限</label>
      <input class="sce-input" type="number" :value="localCfg.maxDepth" @input="setField('maxDepth', num('maxDepth'))" min="1" max="6" />
    </template>

    <!-- got-solve（思维图求解，B 轨 GotNode；由主 Agent 直接执行，不派生子 Agent） -->
    <template v-else-if="stepType === 'got-solve'">
      <label class="sce-label">任务意图</label>
      <textarea class="sce-textarea" :value="localCfg.intent" @input="setField('intent', ($event.target as HTMLTextAreaElement).value)" rows="2" placeholder="要并发求解的创作任务，如：设计一个完整的漂浮空岛王国" />
      <label class="sce-label">拆分提示词 <span class="sce-hint">拆成 2-4 个独立求解视角</span></label>
      <textarea class="sce-textarea" :value="localCfg.splitPrompt" @input="setField('splitPrompt', ($event.target as HTMLTextAreaElement).value)" rows="3" placeholder="如何把任务拆为独立视角（如地理/文化/政治）..." />
      <label class="sce-label">融合提示词</label>
      <textarea class="sce-textarea" :value="localCfg.mergePrompt" @input="setField('mergePrompt', ($event.target as HTMLTextAreaElement).value)" rows="3" placeholder="如何对齐冲突并融合各视角部分解..." />
      <label class="sce-label">评估提示词 <span class="sce-hint">判定融合解是否达标</span></label>
      <textarea class="sce-textarea" :value="localCfg.evaluatePrompt" @input="setField('evaluatePrompt', ($event.target as HTMLTextAreaElement).value)" rows="3" placeholder="判定融合全解是否达标..." />
      <label class="sce-label">再融合轮次上限</label>
      <input class="sce-input" type="number" :value="localCfg.maxRounds" @input="setField('maxRounds', num('maxRounds'))" min="1" max="5" />
    </template>

    <!-- multi-agent（多智能体并行产出+聚合，B 轨 MultiAgentNode + SubAgentWorkerNode 车道 + AggregateNode；
         由主 Agent 直接执行：静态切分 → 车道并发委派子 Agent → LLM 聚合） -->
    <template v-else-if="stepType === 'multi-agent'">
      <label class="sce-label">任务意图</label>
      <textarea class="sce-textarea" :value="localCfg.intent" @input="setField('intent', ($event.target as HTMLTextAreaElement).value)" rows="2" placeholder="要并行产出的创作任务，如：设计一个完整王国的地理/文化/历史三大板块" />
      <label class="sce-label">切分提示词 <span class="sce-hint">静态切成互不阻塞的独立车道</span></label>
      <textarea class="sce-textarea" :value="localCfg.decomposePrompt" @input="setField('decomposePrompt', ($event.target as HTMLTextAreaElement).value)" rows="3" placeholder="如何把任务切为独立车道（每车道由一个子 Agent 产出）..." />
      <label class="sce-label">车道数上限</label>
      <input class="sce-input" type="number" :value="localCfg.maxLanes" @input="setField('maxLanes', num('maxLanes'))" min="1" max="8" />
      <label class="sce-label">子 Agent 规格 <span class="sce-hint">JSON 数组；id/name/description/systemPrompt</span></label>
      <textarea class="sce-textarea" :value="specsText" @input="onSpecsInput" rows="5" placeholder='[{"id":"worldbuilder","name":"世界观架构师","description":"…","systemPrompt":"…"}]' />
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

/** 数字输入：空串/非法回退默认值（tot/got 步骤参数） */
function num(field: string, fallback = 1): number {
  const n = Number(localCfg[field])
  return Number.isFinite(n) && n >= 1 ? n : fallback
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

// multi-agent 子 Agent 规格用 JSON 数组文本（对齐后端 SubAgentSpec）
const specsText = computed(() => {
  const specs = (props.config as any).specs
  return specs ? JSON.stringify(specs, null, 2) : '[]'
})

function onSpecsInput(e: Event) {
  const val = (e.target as HTMLTextAreaElement).value
  try {
    const parsed = JSON.parse(val)
    if (Array.isArray(parsed)) {
      localCfg.specs = parsed
      emit('update:config', { ...localCfg, specs: parsed } as StepConfig)
    }
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
.sce-label { font-size: var(--fs-sm); font-weight: 500; color: var(--text-secondary, #6b7280); margin-top: 4px; }
.sce-hint { font-weight: normal; opacity: 0.6; font-style: italic; }
.sce-input, .sce-select {
  padding: 5px 8px; border-radius: 5px; border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-secondary, #f4f4f5); color: var(--text-primary, #18181b);
  font-size: var(--fs-sm); outline: none;
}
.sce-input:focus, .sce-select:focus, .sce-textarea:focus {
  border-color: var(--primary, #4f46e5);
}
.sce-textarea {
  padding: 6px 8px; border-radius: 5px; border: 1px solid var(--border, #e4e4e7);
  background: var(--bg-secondary, #f4f4f5); color: var(--text-primary, #18181b);
  font-size: var(--fs-sm); outline: none; resize: vertical; font-family: inherit;
}
.sce-checkbox-label {
  display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); cursor: pointer;
  color: var(--text-primary, #18181b);
}
.sce-checkbox-label input[type="checkbox"] {
  accent-color: var(--primary, #4f46e5);
}
</style>
