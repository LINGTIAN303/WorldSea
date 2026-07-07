import { ref, computed } from 'vue'
import type { CreationTemplate, PipelineStep, StepConnection } from '../types'
import { builtinTemplates } from '../templates'
import { usePipeline } from './usePipeline'
import { useEntityStore } from '@worldsmith/entity-core'

const USER_TEMPLATES_KEY = 'worldsmith-pipeline-templates'
const TEMPLATE_ENTITY_TYPE = 'pipeline-template'

/** 从 localStorage 加载用户自定义模板（兼容旧数据） */
function loadUserTemplatesFromLS(): CreationTemplate[] {
  try {
    const raw = localStorage.getItem(USER_TEMPLATES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** 从 EntityStore 加载用户自定义模板 */
function loadUserTemplatesFromStore(): CreationTemplate[] {
  try {
    const entityStore = useEntityStore()
    const entities = (entityStore.entities ?? []).filter(e => e.type === TEMPLATE_ENTITY_TYPE)
    return entities.map(e => {
      const p = e.properties ?? {}
      return {
        id: e.id,
        name: e.name || '',
        description: e.description || '',
        icon: (p.icon as string) || '📋',
        tags: (e.tags ?? []) as string[],
        steps: JSON.parse((p.steps as string) || '[]'),
        connections: JSON.parse((p.connections as string) || '[]'),
      } as CreationTemplate
    })
  } catch {
    return []
  }
}

export function usePipelineTemplates() {
  const entityStore = useEntityStore()
  const { createPipeline } = usePipeline()

  // 合并 localStorage 旧数据到 EntityStore（一次性迁移）
  async function migrateFromLocalStorage() {
    const lsTemplates = loadUserTemplatesFromLS()
    if (lsTemplates.length === 0) return

    const storeTemplates = loadUserTemplatesFromStore()
    const storeIds = new Set(storeTemplates.map(t => t.id))

    for (const tpl of lsTemplates) {
      if (!storeIds.has(tpl.id)) {
        await entityStore.add({
          id: tpl.id,
          type: TEMPLATE_ENTITY_TYPE,
          name: tpl.name,
          description: tpl.description,
          properties: {
            icon: tpl.icon,
            steps: JSON.stringify(tpl.steps),
            connections: JSON.stringify(tpl.connections),
          },
          tags: tpl.tags,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }
    }

    // 迁移完成后清除 localStorage
    localStorage.removeItem(USER_TEMPLATES_KEY)
    await entityStore.loadByType(TEMPLATE_ENTITY_TYPE)
  }

  const userTemplates = ref<CreationTemplate[]>([])

  /** 加载模板数据 */
  async function loadTemplates() {
    await migrateFromLocalStorage()
    userTemplates.value = loadUserTemplatesFromStore()
  }

  // 初始化时自动加载
  loadTemplates()

  /** 所有可用模板（内置 + 用户自定义） */
  const allTemplates = computed<CreationTemplate[]>(() => [
    ...builtinTemplates,
    ...userTemplates.value,
  ])

  /** 内置模板 */
  const builtin = computed(() => builtinTemplates)

  /** 用户自定义模板 */
  const custom = computed(() => userTemplates.value)

  /** 根据 ID 获取模板 */
  function getTemplate(id: string): CreationTemplate | undefined {
    return allTemplates.value.find(t => t.id === id)
  }

  /** 从模板创建 Pipeline */
  async function applyTemplate(
    templateId: string,
    overrides?: { name?: string; description?: string },
  ): Promise<string> {
    const template = getTemplate(templateId)
    if (!template) throw new Error(`模板 "${templateId}" 不存在`)

    // 将模板步骤转换为实际步骤（添加 id 和 status）
    const steps: PipelineStep[] = template.steps.map((s, i) => ({
      ...s,
      id: `step-${Date.now()}-${i}`,
      status: 'pending' as const,
      output: null,
    }))

    // 将模板连接转换为实际连接（从 index 映射到实际 id）
    const connections: StepConnection[] = template.connections.map(c => ({
      from: steps[c.fromIndex]?.id ?? '',
      to: steps[c.toIndex]?.id ?? '',
      dataMapping: c.dataMapping,
    })).filter(c => c.from && c.to)

    const pipeline = await createPipeline({
      name: overrides?.name ?? template.name,
      description: overrides?.description ?? template.description,
      steps,
      connections,
      tags: template.tags,
    })

    return pipeline.id
  }

  /** 保存当前 Pipeline 为用户模板（存到 EntityStore，后端可见） */
  async function saveAsTemplate(params: {
    name: string
    description?: string
    icon?: string
    tags?: string[]
    steps: PipelineStep[]
    connections: StepConnection[]
  }): Promise<CreationTemplate> {
    // 将连接转换为 index-based 格式
    const templateConnections = params.connections.map(c => {
      const fromIndex = params.steps.findIndex(s => s.id === c.from)
      const toIndex = params.steps.findIndex(s => s.id === c.to)
      return {
        fromIndex: fromIndex >= 0 ? fromIndex : 0,
        toIndex: toIndex >= 0 ? toIndex : 0,
        dataMapping: c.dataMapping,
      }
    })

    // 步骤去掉 id/status/output
    const templateSteps = params.steps.map(({ id, status, output, ...rest }) => rest)

    const now = Date.now()
    const templateId = `tpl-${now}-${Math.random().toString(36).slice(2, 6)}`

    const template: CreationTemplate = {
      id: templateId,
      name: params.name,
      description: params.description ?? '',
      icon: params.icon ?? '📋',
      tags: params.tags ?? [],
      steps: templateSteps,
      connections: templateConnections,
    }

    // 存到 EntityStore（后端可通过 EntityStore 访问）
    await entityStore.add({
      id: templateId,
      type: TEMPLATE_ENTITY_TYPE,
      name: template.name,
      description: template.description,
      properties: {
        icon: template.icon,
        steps: JSON.stringify(template.steps),
        connections: JSON.stringify(template.connections),
      },
      tags: template.tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    userTemplates.value = [...userTemplates.value, template]
    return template
  }

  /** 删除用户自定义模板 */
  async function deleteTemplate(id: string): Promise<void> {
    await entityStore.remove(id)
    userTemplates.value = userTemplates.value.filter(t => t.id !== id)
  }

  return {
    allTemplates,
    builtin,
    custom,
    getTemplate,
    applyTemplate,
    saveAsTemplate,
    deleteTemplate,
  }
}
