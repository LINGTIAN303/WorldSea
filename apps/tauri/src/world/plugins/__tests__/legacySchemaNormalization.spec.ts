import { describe, expect, it, vi } from 'vitest'

vi.mock('../orchestration/OrchestrationView.vue', () => ({ default: {} }))
vi.mock('../tactical-board/TacticalBoardView.vue', () => ({ default: {} }))
vi.mock('../timeline/TimelineView.vue', () => ({ default: {} }))

import { apply as applyOrchestration } from '../orchestration'
import { apply as applyTacticalBoard } from '../tactical-board'
import { apply as applyTimeline } from '../timeline'

function captureApi() {
  const calls: any[] = []
  return {
    calls,
    api: {
      registerEntityV2: (params: any) => calls.push(params),
      registerEntityType: (params: any) => calls.push({ ...params, _legacy: true }),
      registerView: () => {},
      registerOverlay: () => {},
      registerRelationV2: () => {},
      registerFacet: () => {},
      capabilities: { register: async () => {} },
    },
  }
}

/**
 * 最小 cordis 上下文桩：本 spec 只验 schema 注册面，不关心迁移扩展点。
 * `timeline` 现经 `ctx.get('world.projectExtras')` 取服务，故此处返回一对不产生副作用的注册函数。
 */
function fakeCtx(): any {
  return {
    get: (_name: string) => ({
      registerPackSerializer: () => () => {},
      registerProjectExtraProvider: () => () => {},
    }),
    effect: (fn: () => unknown) => fn(),
  }
}

describe('旧版实体 schema 归一', () => {
  it('pipeline 使用 V2 方言：identifiable + taggable，业务字段留在 ownFields', () => {
    const { calls, api } = captureApi()
    applyOrchestration(null, api as any)
    expect(calls).toHaveLength(1)
    expect(calls[0].type).toBe('pipeline')
    expect(calls[0].traits.map((t: any) => t.traitId)).toEqual(['identifiable', 'taggable'])
    expect(calls[0].ownFields.map((f: any) => f.key)).toEqual(['steps', 'connections', 'status', 'currentStepId'])
    expect(calls[0].ownFields.some((f: any) => ['name', 'description', 'tags'].includes(f.key))).toBe(false)
  })

  it('tactical-board 使用 V2 方言，且不再声明与顶层同名的 coverImage', () => {
    const { calls, api } = captureApi()
    applyTacticalBoard(null, api as any)
    expect(calls).toHaveLength(1)
    expect(calls[0].type).toBe('tactical-board')
    expect(calls[0].traits.map((t: any) => t.traitId)).toEqual(['identifiable', 'taggable', 'visual'])
    const keys = calls[0].ownFields.map((f: any) => f.key)
    expect(keys).toEqual(['gridType', 'gridSize', 'terrain', 'units', 'combatStats', 'battleState'])
    expect(keys).not.toContain('coverImage')
  })
})

describe('事件父级字段口径', () => {
  it('parentId 仍是 entityRef + refType，且刻意不声明 relationType', () => {
    const { calls, api } = captureApi()
    applyTimeline(fakeCtx(), api as any)
    const parentId = calls[0].ownFields.find((f: any) => f.key === 'parentId')
    expect(parentId).toMatchObject({ fieldType: 'entityRef', refType: 'event', label: '父级事件' })
    expect(parentId.relationType).toBeUndefined()
  })
})
