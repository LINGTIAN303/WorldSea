import { ref, computed } from 'vue'
import type { StepType, StepLibraryItem, StepConfig } from '../types'

/** 内置步骤库 */
const BUILTIN_LIBRARY: StepLibraryItem[] = [
  {
    type: 'agent-task',
    label: 'Agent 创作任务',
    icon: '🤖',
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
    icon: '👁️',
    description: '暂停执行，等待用户审阅当前结果并确认',
    defaultConfig: {
      instruction: '请审阅当前步骤的创作结果，确认无误后继续。',
      skippable: true,
    },
  },
  {
    type: 'batch-create',
    label: '批量创建实体',
    icon: '📦',
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
    icon: '📋',
    description: '套用预设的创作模板，快速生成结构化内容',
    defaultConfig: {
      templateId: '',
      overrides: {},
    },
  },
  {
    type: 'consistency-check',
    label: '一致性校验',
    icon: '🔍',
    description: '检查已创作内容之间是否存在矛盾或不一致',
    defaultConfig: {
      scope: 'all',
      strictness: 'normal',
    },
  },
  {
    type: 'transform',
    label: '数据转换',
    icon: '🔄',
    description: '对已有创作内容进行转换或重组',
    defaultConfig: {
      description: '',
      rules: '',
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
}

/** 步骤类型对应的图标 */
export const STEP_TYPE_ICONS: Record<StepType, string> = {
  'agent-task': '🤖',
  'user-review': '👁️',
  'batch-create': '📦',
  'template-apply': '📋',
  'consistency-check': '🔍',
  'transform': '🔄',
}

/** 步骤类型对应的颜色 */
export const STEP_TYPE_COLORS: Record<StepType, string> = {
  'agent-task': 'var(--primary, #58a6ff)',
  'user-review': 'var(--warning, #d29922)',
  'batch-create': 'var(--success, #3fb950)',
  'template-apply': 'var(--info, #79c0ff)',
  'consistency-check': 'var(--danger, #f85149)',
  'transform': 'var(--secondary, #8b949e)',
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

  /** 获取步骤类型的显示信息 */
  function getStepDisplay(type: StepType) {
    return {
      label: STEP_TYPE_LABELS[type],
      icon: STEP_TYPE_ICONS[type],
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
    STEP_TYPE_ICONS,
    STEP_TYPE_COLORS,
  }
}
