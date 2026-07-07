import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { usePipelineExecution } from '../../composables/usePipelineExecution'
import type { CreationPipeline } from '../../types'

// Mock usePipeline with reactive selectedPipeline
const mockUpdateStepStatus = vi.fn()
const mockUpdatePipeline = vi.fn()
const mockSelectedPipeline = ref<CreationPipeline | null>(null)

vi.mock('../../composables/usePipeline', () => ({
  usePipeline: () => ({
    selectedPipeline: mockSelectedPipeline,
    updateStepStatus: mockUpdateStepStatus,
    updatePipeline: mockUpdatePipeline,
  }),
}))

let testPipeline: CreationPipeline

function makeTestPipeline(): CreationPipeline {
  return {
    id: 'pipeline-test',
    name: '测试 Pipeline',
    description: '',
    steps: [
      { id: 's1', type: 'agent-task', title: '步骤1', config: { prompt: 'task1' }, status: 'pending', output: null },
      { id: 's2', type: 'user-review', title: '审阅', config: { instruction: 'check', skippable: true }, status: 'pending', output: null },
      { id: 's3', type: 'consistency-check', title: '校验', config: { scope: 'all', strictness: 'normal' }, status: 'pending', output: null },
    ],
    connections: [],
    tags: [],
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('usePipelineExecution', () => {
  beforeEach(() => {
    mockUpdateStepStatus.mockReset()
    mockUpdatePipeline.mockReset()
    testPipeline = makeTestPipeline()
    mockSelectedPipeline.value = testPipeline
  })

  it('初始化时 currentStep 应为 null', () => {
    const { currentStep } = usePipelineExecution()
    expect(currentStep.value).toBeNull()
  })

  it('初始化时进度应为 0', () => {
    const { progress } = usePipelineExecution()
    expect(progress.value).toBe(0)
  })

  it('初始化时 executionLog 应为空', () => {
    const { executionLog } = usePipelineExecution()
    expect(executionLog.value).toEqual([])
  })

  it('findNextPendingStep 应找到第一个待执行步骤', () => {
    const { findNextPendingStep } = usePipelineExecution()
    const pipeline = makeTestPipeline()
    pipeline.steps[0].status = 'completed'
    const idx = findNextPendingStep(pipeline)
    expect(idx).toBe(1) // s2 is the first pending
  })

  it('findNextPendingStep 所有步骤完成时应返回 -1', () => {
    const { findNextPendingStep } = usePipelineExecution()
    const pipeline = makeTestPipeline()
    pipeline.steps.forEach(s => (s.status = 'completed'))
    expect(findNextPendingStep(pipeline)).toBe(-1)
  })

  it('confirmReview 应调用 updateStepStatus', async () => {
    const { confirmReview } = usePipelineExecution()
    await confirmReview('s2')
    expect(mockUpdateStepStatus).toHaveBeenCalledWith('pipeline-test', 's2', 'completed', expect.any(Object))
  })

  it('skipStep 应调用 updateStepStatus 为 skipped', async () => {
    const { skipStep } = usePipelineExecution()
    await skipStep('s2')
    expect(mockUpdateStepStatus).toHaveBeenCalledWith('pipeline-test', 's2', 'skipped')
  })

  it('markStepCompleted 应更新状态', async () => {
    const { markStepCompleted } = usePipelineExecution()
    await markStepCompleted('s1', { summary: '完成' })
    expect(mockUpdateStepStatus).toHaveBeenCalledWith('pipeline-test', 's1', 'completed', { summary: '完成' })
  })

  it('markStepFailed 应更新为 failed', async () => {
    const { markStepFailed } = usePipelineExecution()
    await markStepFailed('s1', '失败')
    expect(mockUpdateStepStatus).toHaveBeenCalledWith('pipeline-test', 's1', 'failed', { summary: '失败: 失败' })
  })

  it('executeStep 应记录步骤执行日志', async () => {
    const { executeStep, executionLog } = usePipelineExecution()
    await executeStep('s1')
    expect(executionLog.value.length).toBeGreaterThanOrEqual(1)
    expect(executionLog.value[0]).toContain('步骤1')
  })

  it('progress 应反映完成步骤比例', async () => {
    const { progress } = usePipelineExecution()
    expect(progress.value).toBe(0)

    // 通过触发 reactivity 更新来测试
    const updatedPipeline = { ...testPipeline, steps: testPipeline.steps.map(s => ({ ...s })) }
    updatedPipeline.steps[0].status = 'completed'
    mockSelectedPipeline.value = updatedPipeline
    expect(progress.value).toBeGreaterThanOrEqual(33)
  })

  it('resetPipeline 应重置所有步骤为 pending', async () => {
    testPipeline.steps[0].status = 'completed'
    testPipeline.steps[1].status = 'running'

    const { resetPipeline } = usePipelineExecution()
    await resetPipeline('pipeline-test')

    expect(mockUpdatePipeline).toHaveBeenCalled()
    const updateCall = mockUpdatePipeline.mock.calls[0]
    expect(updateCall[0]).toBe('pipeline-test')
    expect(updateCall[1]).toHaveProperty('status', 'draft')
    expect(updateCall[1]).toHaveProperty('currentStepId', null)
    expect(updateCall[1].steps).toBeDefined()
    for (const step of updateCall[1].steps) {
      expect(step.status).toBe('pending')
    }
  })

  it('当前步骤执行时日志应被追加', async () => {
    const { executeStep, executionLog } = usePipelineExecution()
    expect(executionLog.value).toHaveLength(0)

    await executeStep('s1')
    expect(executionLog.value.length).toBeGreaterThanOrEqual(1)
    expect(executionLog.value[0]).toContain('步骤1')
  })

  it('confirmReview 应追加日志', async () => {
    const { confirmReview, executionLog } = usePipelineExecution()
    const before = executionLog.value.length
    await confirmReview('s2')
    expect(executionLog.value.length).toBeGreaterThan(before)
  })
})
