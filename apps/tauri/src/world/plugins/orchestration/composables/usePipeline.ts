import { ref, computed } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import type {
  CreationPipeline,
  PipelineStep,
  StepConnection,
  PipelineStatus,
  PipelineSummary,
} from '../types'
import { getWorldService } from '../../../service-registry'
import type { WorldEntitiesService } from '../../../services'

/** 取数经树服务（唯一取数通道，换数据源只改 services.ts）；取不到属时序被破坏，报错不降级。 */
function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[orchestration] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}

const PIPELINE_TYPE = 'pipeline'

/** Entity → CreationPipeline */
function entityToPipeline(e: Entity): CreationPipeline {
  const p = e.properties ?? {}
  let steps: PipelineStep[] = []
  let connections: StepConnection[] = []
  try { steps = JSON.parse((p.steps as string) || '[]') } catch { steps = [] }
  try { connections = JSON.parse((p.connections as string) || '[]') } catch { connections = [] }

  return {
    id: e.id,
    name: e.name || '',
    description: e.description || '',
    steps,
    connections,
    tags: (e.tags ?? []) as string[],
    status: (p.status as PipelineStatus) || 'draft',
    currentStepId: (p.currentStepId as string) || null,
    createdAt: typeof e.createdAt === 'number' ? e.createdAt : new Date(e.createdAt as string).getTime(),
    updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : new Date(e.updatedAt as string).getTime(),
  }
}

export function usePipeline() {
    const selectedId = ref<string | null>(null)

  /** 所有 pipeline 实体 */
  const pipelineEntities = computed(() =>
    (entitiesSvc().list() ?? []).filter(e => e.type === PIPELINE_TYPE),
  )

  /** Pipeline 列表（摘要） */
  const pipelineList = computed<PipelineSummary[]>(() =>
    pipelineEntities.value.map(e => {
      const p = entityToPipeline(e)
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        tags: p.tags,
        status: p.status,
        stepCount: p.steps.length,
        completedSteps: p.steps.filter(s => s.status === 'completed').length,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }
    }).sort((a, b) => b.updatedAt - a.updatedAt),
  )

  /** 当前选中的 Pipeline 详情 */
  const selectedPipeline = computed<CreationPipeline | null>(() => {
    if (!selectedId.value) return null
    const e = entitiesSvc().get(selectedId.value)
    return e ? entityToPipeline(e) : null
  })

  /** 加载所有 Pipeline */
  async function loadPipelines() {
    await entitiesSvc().loadByType(PIPELINE_TYPE)
  }

  /** 创建新 Pipeline */
  async function createPipeline(params: {
    name: string
    description?: string
    steps?: PipelineStep[]
    connections?: StepConnection[]
    tags?: string[]
  }): Promise<CreationPipeline> {
    const now = Date.now()
    const id = `pipeline-${now}-${Math.random().toString(36).slice(2, 6)}`
    const steps = params.steps ?? []
    const connections = params.connections ?? []

    const entity: Entity = {
      id,
      type: PIPELINE_TYPE,
      name: params.name,
      description: params.description ?? '',
      properties: {
        steps: JSON.stringify(steps),
        connections: JSON.stringify(connections),
        status: 'draft' satisfies PipelineStatus,
      },
      tags: params.tags ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await entitiesSvc().add(entity)
    await entitiesSvc().loadByType(PIPELINE_TYPE)
    return entityToPipeline(entitiesSvc().get(id)!)
  }

  /** 更新 Pipeline */
  async function updatePipeline(
    id: string,
    changes: Partial<{
      name: string
      description: string
      steps: PipelineStep[]
      connections: StepConnection[]
      tags: string[]
      status: PipelineStatus
      currentStepId: string | null
    }>,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {}
    const propsUpdate: Record<string, unknown> = {}

    if (changes.name !== undefined) updateData.name = changes.name
    if (changes.description !== undefined) updateData.description = changes.description
    if (changes.tags !== undefined) updateData.tags = changes.tags
    if (changes.steps !== undefined) propsUpdate.steps = JSON.stringify(changes.steps)
    if (changes.connections !== undefined) propsUpdate.connections = JSON.stringify(changes.connections)
    if (changes.status !== undefined) propsUpdate.status = changes.status
    if (changes.currentStepId !== undefined) propsUpdate.currentStepId = changes.currentStepId

    if (Object.keys(propsUpdate).length > 0) {
      updateData.properties = propsUpdate
    }

    await entitiesSvc().update(id, updateData)
    await entitiesSvc().loadByType(PIPELINE_TYPE)
  }

  /** 删除 Pipeline */
  async function deletePipeline(id: string): Promise<void> {
    await entitiesSvc().remove(id)
    if (selectedId.value === id) selectedId.value = null
    await entitiesSvc().loadByType(PIPELINE_TYPE)
  }

  /** 选中 Pipeline */
  function selectPipeline(id: string | null) {
    selectedId.value = id
  }

  /** 添加步骤到 Pipeline */
  async function addStep(
    pipelineId: string,
    step: Omit<PipelineStep, 'id' | 'status' | 'output'>,
  ): Promise<void> {
    const pipeline = selectedPipeline.value?.id === pipelineId
      ? selectedPipeline.value
      : entityToPipeline(entitiesSvc().get(pipelineId)!)

    if (!pipeline) return

    const newStep: PipelineStep = {
      ...step,
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
      status: 'pending',
    }
    const steps = [...pipeline.steps, newStep]
    await updatePipeline(pipelineId, { steps })
  }

  /** 移除步骤 */
  async function removeStep(pipelineId: string, stepId: string): Promise<void> {
    const pipeline = selectedPipeline.value?.id === pipelineId
      ? selectedPipeline.value
      : entityToPipeline(entitiesSvc().get(pipelineId)!)

    if (!pipeline) return

    const steps = pipeline.steps.filter(s => s.id !== stepId)
    const connections = pipeline.connections.filter(c => c.from !== stepId && c.to !== stepId)
    await updatePipeline(pipelineId, { steps, connections })
  }

  /** 添加连接 */
  async function addConnection(pipelineId: string, connection: StepConnection): Promise<void> {
    const pipeline = selectedPipeline.value?.id === pipelineId
      ? selectedPipeline.value
      : entityToPipeline(entitiesSvc().get(pipelineId)!)

    if (!pipeline) return

    const connections = [...pipeline.connections, connection]
    await updatePipeline(pipelineId, { connections })
  }

  /** 更新步骤状态 */
  async function updateStepStatus(
    pipelineId: string,
    stepId: string,
    status: PipelineStep['status'],
    output?: PipelineStep['output'],
  ): Promise<void> {
    const pipeline = selectedPipeline.value?.id === pipelineId
      ? selectedPipeline.value
      : entityToPipeline(entitiesSvc().get(pipelineId)!)

    if (!pipeline) return

    const steps = pipeline.steps.map(s =>
      s.id === stepId ? { ...s, status, output: output ?? s.output } : s,
    )
    await updatePipeline(pipelineId, { steps })
  }

  /** 更新步骤（标题、配置等） */
  async function updateStep(
    pipelineId: string,
    stepId: string,
    changes: Partial<Pick<PipelineStep, 'title' | 'config'>>,
  ): Promise<void> {
    const pipeline = selectedPipeline.value?.id === pipelineId
      ? selectedPipeline.value
      : entityToPipeline(entitiesSvc().get(pipelineId)!)

    if (!pipeline) return

    const steps = pipeline.steps.map(s =>
      s.id === stepId ? { ...s, ...changes } : s,
    )
    await updatePipeline(pipelineId, { steps })
  }

  /** 步骤排序（拖拽后调用） */
  async function reorderSteps(
    pipelineId: string,
    stepIds: string[],
  ): Promise<void> {
    const pipeline = selectedPipeline.value?.id === pipelineId
      ? selectedPipeline.value
      : entityToPipeline(entitiesSvc().get(pipelineId)!)

    if (!pipeline) return

    const stepMap = new Map(pipeline.steps.map(s => [s.id, s]))
    const reordered = stepIds
      .map(id => stepMap.get(id))
      .filter((s): s is PipelineStep => !!s)
    // 保留未被包含的步骤在末尾
    const remaining = pipeline.steps.filter(s => !stepIds.includes(s.id))
    await updatePipeline(pipelineId, { steps: [...reordered, ...remaining] })
  }

  /** 移除连接 */
  async function removeConnection(pipelineId: string, from: string, to: string): Promise<void> {
    const pipeline = selectedPipeline.value?.id === pipelineId
      ? selectedPipeline.value
      : entityToPipeline(entitiesSvc().get(pipelineId)!)

    if (!pipeline) return

    const connections = pipeline.connections.filter(c => !(c.from === from && c.to === to))
    await updatePipeline(pipelineId, { connections })
  }

  return {
    // 状态
    selectedId,
    selectedPipeline,
    pipelineList,
    // CRUD
    loadPipelines,
    createPipeline,
    updatePipeline,
    deletePipeline,
    selectPipeline,
    // 步骤操作
    addStep,
    removeStep,
    addConnection,
    removeConnection,
    updateStepStatus,
    updateStep,
    reorderSteps,
    // 辅助
    entityToPipeline,
  }
}
