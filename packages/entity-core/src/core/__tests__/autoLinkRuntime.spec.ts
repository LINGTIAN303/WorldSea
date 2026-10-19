import { beforeEach, describe, expect, it } from 'vitest'
import { autoLinkRuntime, clearAutoLinkEvents, recordAutoLinkEvent } from '../AutoLinkRuntime'
import { autoLinkDecisionStore } from '../AutoLinkDecisions'
import { potentialLinkIndex, type PotentialLink } from '../PotentialLinkIndex'

describe('AutoLinkRuntime 事件环', () => {
  beforeEach(() => clearAutoLinkEvents())

  it('最新在前，最多保留 200 条', () => {
    for (let i = 0; i < 205; i++) recordAutoLinkEvent('link:add', `link-${i}`)
    expect(autoLinkRuntime.events.value).toHaveLength(200)
    expect(autoLinkRuntime.events.value[0].summary).toBe('link-204')
    expect(autoLinkRuntime.events.value[199].summary).toBe('link-5')
    expect(autoLinkRuntime.version.value).toBeGreaterThan(0)
  })

  it('clear 只清事件缓冲', () => {
    recordAutoLinkEvent('index:start', 'start')
    clearAutoLinkEvents()
    expect(autoLinkRuntime.events.value).toHaveLength(0)
  })
})

describe('AutoLink 观测埋点', () => {
  beforeEach(() => {
    clearAutoLinkEvents()
    autoLinkDecisionStore.clear()
  })

  it('链接新增/处理产生事件', () => {
    const link: PotentialLink = {
      id: 'test-link-field-matrix',
      sourceEntityId: 'source-1',
      sourceFieldKey: 'origin',
      sourceText: '北境',
      targetEntityId: 'target-1',
      targetEntityType: 'region',
      targetFieldValue: '北境',
      hint: 'origin',
      relationType: 'located_at',
      direction: 'source',
      confidence: 'exact',
      score: 1,
      resolved: false,
      createdAt: new Date().toISOString(),
    }
    potentialLinkIndex.add(link)
    expect(autoLinkRuntime.events.value[0]).toMatchObject({ kind: 'link:add' })
    potentialLinkIndex.resolve(link.id, 'confirmed')
    expect(autoLinkRuntime.events.value[0]).toMatchObject({ kind: 'link:resolve' })
  })

  it('决策写入可被 getAll 读取并产生事件', () => {
    autoLinkDecisionStore.record({
      sourceEntityId: 'source-1',
      sourceFieldKey: 'origin',
      targetEntityId: 'target-1',
      relationType: 'located_at',
      sourceText: '北境',
      targetFieldValue: '北境',
    }, 'confirmed')
    expect(autoLinkDecisionStore.getAll()).toHaveLength(1)
    expect(autoLinkRuntime.events.value[0]).toMatchObject({ kind: 'decision:record' })
  })
})
