import { ref, computed } from 'vue'
import type { StepType, StepLibraryItem, StepConfig } from '../types'

/**
 * 内置步骤库
 *
 * 2026-09-09 全量图标 tabler 化：icon 字段不再承载具体图标
 * （渲染统一经 components/StepTypeIcon.vue 使用 tabler SVG 图标，合规禁 emoji）。
 */
const BUILTIN_LIBRARY: StepLibraryItem[] = [
  {
    type: 'agent-task',
    label: 'Agent 创作任务',
    icon: '',
    description: '让 Agent 执行一个创作任务（生成角色、设计地理、推演关系等）',
    defaultConfig: {
      prompt: '',
      skillIds: [],
      targetEntityType: '',
      expectedOutput: '',
    },
  },
  {
    type: 'user-review',
    label: '用户审阅',
    icon: '',
    description: '暂停执行，等待用户审阅当前结果并确认',
    defaultConfig: {
      instruction: '请审阅当前步骤的创作结果，确认无误后继续。',
      skippable: true,
    },
  },
  {
    type: 'batch-create',
    label: '批量创建实体',
    icon: '',
    description: '批量创建指定类型的实体（角色、区域、组织等）',
    defaultConfig: {
      entityType: 'character',
      count: 5,
      context: '',
      namePrefix: '',
    },
  },
  {
    type: 'template-apply',
    label: '套用模板',
    icon: '',
    description: '套用预设的创作模板，快速生成结构化内容',
    defaultConfig: {
      templateId: '',
      overrides: {},
    },
  },
  {
    type: 'consistency-check',
    label: '一致性校验',
    icon: '',
    description: '检查已创作内容之间是否存在矛盾或不一致',
    defaultConfig: {
      scope: 'all',
      strictness: 'normal',
    },
  },
  {
    type: 'transform',
    label: '数据转换',
    icon: '',
    description: '对已有创作内容进行转换或重组',
    defaultConfig: {
      description: '',
      rules: '',
    },
  },
  {
    type: 'tot-search',
    label: '思维树探索',
    icon: '',
    description: '思维树搜索（ToT）：多分支展开→评分→剪枝择优，为创作目标选出最优方向（如结局方案、风格路线）',
    defaultConfig: {
      intent: '',
      expandPrompt: '你是创作方案展开器。基于当前分支方案，生成多个有区分度的候选细化方案，彼此不得重复。',
      evaluatePrompt: '你是创作方案评审。对给定候选方案按与创作意图的契合度、新颖性、可行性打 0-100 分。',
      branchingK: 3,
      keepTopB: 2,
      maxDepth: 3,
    },
  },
  {
    type: 'got-solve',
    label: '思维图求解',
    icon: '',
    description: '思维图求解（GoT）：任务拆分为多个视角并发求解后融合评估（如王国设计 = 地理+文化+政治视角）',
    defaultConfig: {
      intent: '',
      splitPrompt: '你是任务拆分器。把给定创作任务拆为 2-4 个相互独立的求解视角，每个视角可单独产出部分解。',
      mergePrompt: '你是创作融合器。对齐各视角部分解的冲突点，融合为一份统一、自洽的完整设定。',
      evaluatePrompt: '你是创作验收者。判断融合全解是否达标：覆盖全部视角、逻辑自洽、符合原任务意图。',
      maxRounds: 2,
    },
  },
  {
    type: 'multi-agent',
    label: '多智能体协作',
    icon: '',
    description: '多智能体并行产出+聚合（Multi-Agent）：静态切分为多个独立车道，并发委派子 Agent 产出后聚合（如世界观 = 地理+文化+历史并行设计）',
    defaultConfig: {
      intent: '',
      decomposePrompt: '你是任务切分器。把给定创作任务静态切分为 2-4 个互不阻塞的独立车道，每车道可由一个子 Agent 独立产出。',
      maxLanes: 4,
      specs: [
        { id: 'worldbuilder', name: '世界观架构师', description: '擅长地理、文化、政治架构设计', systemPrompt: '你是资深世界观架构师，为奇幻/科幻世界提供自洽的系统化设定。' },
        { id: 'character-writer', name: '角色作者', description: '擅长角色塑造与人物关系', systemPrompt: '你是专业角色作者，能设计有深度的人物档案与关系网。' },
      ],
    },
  },
]

/** 步骤类型对应的中文标签 */
export const STEP_TYPE_LABELS: Record<StepType, string> = {
  'agent-task': 'Agent 任务',
  'user-review': '用户审阅',
  'batch-create': '批量创建',
  'template-apply': '套用模板',
  'consistency-check': '一致性校验',
  'transform': '数据转换',
  'tot-search': '思维树探索',
  'got-solve': '思维图求解',
  'multi-agent': '多智能体协作',
}

/** 步骤类型对应的颜色（2026-09-09 图标 tabler 化后不再有 STEP_TYPE_ICONS；图标经 StepTypeIcon 渲染） */
export const STEP_TYPE_COLORS: Record<StepType, string> = {
  'agent-task': 'var(--primary, #4f46e5)',
  'user-review': 'var(--warning, #d97706)',
  'batch-create': 'var(--success, #16a34a)',
  'template-apply': 'var(--info, #79c0ff)',
  'consistency-check': 'var(--danger, #dc2626)',
  'transform': 'var(--secondary, #6b7280)',
  'tot-search': 'var(--primary, #6366f1)',
  'got-solve': '#06b6d4',
  'multi-agent': '#8b5cf6',
}

export function useStepLibrary() {
  const searchQuery = ref('')

  /** 完整的步骤库（内置 + 可扩展） */
  const library = ref<StepLibraryItem[]>([...BUILTIN_LIBRARY])

  /** 过滤后的步骤库 */
  const filteredLibrary = computed(() => {
    if (!searchQuery.value) return library.value
    const q = searchQuery.value.toLowerCase()
    return library.value.filter(
      item =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.type.includes(q),
    )
  })

  /** 获取步骤库项 */
  function getLibraryItem(type: StepType): StepLibraryItem | undefined {
    return library.value.find(item => item.type === type)
  }

  /** 获取步骤类型的默认配置 */
  function getDefaultConfig(type: StepType): StepConfig {
    const item = getLibraryItem(type)
    return item ? { ...item.defaultConfig } : { prompt: '' } as StepConfig
  }

  /** 获取步骤类型的显示信息（图标经 StepTypeIcon 统一渲染，此处仅 label/color） */
  function getStepDisplay(type: StepType) {
    return {
      label: STEP_TYPE_LABELS[type],
      color: STEP_TYPE_COLORS[type],
    }
  }

  return {
    searchQuery,
    library,
    filteredLibrary,
    getLibraryItem,
    getDefaultConfig,
    getStepDisplay,
    STEP_TYPE_LABELS,
    STEP_TYPE_COLORS,
  }
}
