import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePipeline } from '../../composables/usePipeline'
import type { Entity } from '@worldsmith/entity-core'

// Mock entity-store
const mockEntities = vi.fn()
const mockEntityMap = new Map<string, Entity>()
const mockLoadByType = vi.fn()
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockRemove = vi.fn()

vi.mock('@worldsmith/entity-core', () => ({
  useEntityStore: () => ({
    entities: mockEntities(),
    entityMap: mockEntityMap,
    loadByType: mockLoadByType,
    add: mockAdd,
    update: mockUpdate,
    remove: mockRemove,
  }),
}))

function makePipelineEntity(overrides?: Partial<Entity>): Entity {
  return {
    id: 'test-pipeline-1',
    type: 'pipeline',
    name: '测试计划',
    description: '一个测试用的创作计划',
    properties: {
      steps: JSON.stringify([
        { id: 'step-1', type: 'agent-task', title: '测试步骤', status: 'pending', config: { prompt: 'test' } },
      ]),
      connections: JSON.stringify([]),
      status: 'draft',
    },
    tags: ['测试'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('usePipeline', () => {
  beforeEach(() => {
    mockEntityMap.clear()
    mockEntities.mockReturnValue([])
    mockLoadByType.mockReset()
    mockAdd.mockReset()
    mockUpdate.mockReset()
    mockRemove.mockReset()
  })

  it('pipelineList 应为空数组当无 pipeline 实体时', () => {
    mockEntities.mockReturnValue([])
    const { pipelineList } = usePipeline()
    expect(pipelineList.value).toEqual([])
  })

  it('pipelineList 应正确转换实体为摘要', () => {
    const entity = makePipelineEntity()
    mockEntities.mockReturnValue([entity])
    mockEntityMap.set(entity.id, entity)

    const { pipelineList } = usePipeline()
    expect(pipelineList.value).toHaveLength(1)
    expect(pipelineList.value[0].name).toBe('测试计划')
    expect(pipelineList.value[0].stepCount).toBe(1)
    expect(pipelineList.value[0].completedSteps).toBe(0)
    expect(pipelineList.value[0].status).toBe('draft')
  })

  it('pipelineList 应按 updatedAt 降序排列', () => {
    const e1 = makePipelineEntity({ id: 'p1', name: '旧的', updatedAt: '100' })
    const e2 = makePipelineEntity({ id: 'p2', name: '新的', updatedAt: '200' })
    mockEntities.mockReturnValue([e1, e2])
    mockEntityMap.set('p1', e1)
    mockEntityMap.set('p2', e2)

    const { pipelineList } = usePipeline()
    expect(pipelineList.value[0].name).toBe('新的')
    expect(pipelineList.value[1].name).toBe('旧的')
  })

  it('selectPipeline 应能选中和取消选中', () => {
    const entity = makePipelineEntity()
    mockEntityMap.set(entity.id, entity)

    const { selectedId, selectedPipeline, selectPipeline } = usePipeline()

    // 选中
    selectPipeline(entity.id)
    expect(selectedId.value).toBe(entity.id)
    expect(selectedPipeline.value).not.toBeNull()
    expect(selectedPipeline.value!.name).toBe('测试计划')

    // 取消选中
    selectPipeline(null)
    expect(selectedId.value).toBeNull()
    expect(selectedPipeline.value).toBeNull()
  })

  it('createPipeline 应创建新的 pipeline 实体', async () => {
    const { createPipeline } = usePipeline()

    // 模拟 add 后实体出现在 entityMap 中
    mockAdd.mockImplementation(async (entity: Entity) => {
      mockEntityMap.set(entity.id, entity)
    })

    // 模拟 loadByType 后 entities 包含新实体
    mockLoadByType.mockImplementation(async () => {
      mockEntities.mockReturnValue(Array.from(mockEntityMap.values()))
    })

    const pipeline = await createPipeline({
      name: '新建计划',
      description: '描述',
    })

    expect(pipeline.name).toBe('新建计划')
    expect(pipeline.status).toBe('draft')
    expect(pipeline.steps).toEqual([])
    expect(pipeline.id).toContain('pipeline-')
  })

  it('deletePipeline 应删除并取消选中', async () => {
    const entity = makePipelineEntity()
    mockEntityMap.set(entity.id, entity)
    mockEntities.mockReturnValue([entity])

    const { deletePipeline, selectPipeline, selectedId } = usePipeline()
    selectPipeline(entity.id)
    expect(selectedId.value).toBe(entity.id)

    await deletePipeline(entity.id)
    expect(mockRemove).toHaveBeenCalledWith(entity.id)
    expect(selectedId.value).toBeNull()
  })

  it('addStep 应添加步骤到 pipeline', async () => {
    const entity = makePipelineEntity()
    mockEntityMap.set(entity.id, entity)

    const { selectPipeline, addStep } = usePipeline()
    selectPipeline(entity.id)

    await addStep(entity.id, {
      type: 'user-review',
      title: '审阅步骤',
      config: { instruction: '请审阅', skippable: true },
    })

    expect(mockUpdate).toHaveBeenCalled()
    const updateCall = mockUpdate.mock.calls[0]
    expect(updateCall[0]).toBe(entity.id)
  })

  it('updateStepStatus 应更新步骤状态', async () => {
    const entity = makePipelineEntity()
    mockEntityMap.set(entity.id, entity)

    const { selectPipeline, updateStepStatus } = usePipeline()
    selectPipeline(entity.id)

    await updateStepStatus(entity.id, 'step-1', 'completed', { summary: '完成' })

    expect(mockUpdate).toHaveBeenCalled()
  })

  it('removeStep 应移除步骤和相关连接', async () => {
    const entity = makePipelineEntity()
    mockEntityMap.set(entity.id, entity)

    const { selectPipeline, removeStep } = usePipeline()
    selectPipeline(entity.id)

    await removeStep(entity.id, 'step-1')
    expect(mockUpdate).toHaveBeenCalled()
  })
})
