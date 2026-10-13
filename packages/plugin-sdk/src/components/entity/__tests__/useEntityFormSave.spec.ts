/**
 * 弹窗保存链的 entityRef 语义守卫（裁定：统一存 id）。为什么单独锁：并轨前弹窗的
 * entityRef 存**名称串**、抽屉存 **id**，同一字段两个入口落出两种形态；现统一为 id 且
 * 关系同步按 id 命中——改名不断链、同名实体不误关联。若有人改回按名称匹配，本文件必须报红。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

// vi.mock 会被提升到文件顶部，mock 句柄必须经 vi.hoisted 一并提前创建
const mocks = vi.hoisted(() => ({
  putRelation: vi.fn(async () => {}),
  deleteRelation: vi.fn(async () => {}),
  getRelationsByEntity: vi.fn(async () => [] as unknown[]),
}))

vi.mock('@worldsea/entity-core', () => ({
  storage: mocks,
  useEntityStore: () => ({}),
}))

import { useEntityFormSave } from '../useEntityFormSave'

const { putRelation, deleteRelation, getRelationsByEntity } = mocks

const lin = { id: 'sp-1', type: 'species', name: '林族' }

function mk(formData: Record<string, unknown>, fields: any[]) {
  const entityStore = {
    entities: [lin],
    entityMap: new Map([[lin.id, lin] as [string, unknown]]),
  }
  const emit = vi.fn()
  const api = useEntityFormSave({
    formData: ref(formData),
    nameError: ref(''),
    sortedFields: ref(fields),
    entityStore: entityStore as never,
    entity: () => ({ id: 'ev-1', name: '旧名', description: '', properties: {}, tags: [] }) as never,
    emit: emit as never,
  })
  return { api, emit }
}

const nameField = { key: 'name', label: '名称', type: 'text', required: true }
const raceField = { key: 'race', label: '种族', type: 'entityRef', relationType: 'belongs_to', refType: 'species' }

beforeEach(() => {
  putRelation.mockClear()
  deleteRelation.mockClear()
  getRelationsByEntity.mockClear()
})

describe('useEntityFormSave —— entityRef 按 id 同步关系', () => {
  it('值是实体 id 时建关系，targetId 即该 id', async () => {
    const { api } = mk({ name: '赤焰', race: 'sp-1' }, [nameField, raceField])
    api.save()
    await vi.waitFor(() => expect(putRelation).toHaveBeenCalledTimes(1))
    const rel = putRelation.mock.calls[0][0] as { sourceId: string; targetId: string; type: string }
    expect(rel.targetId).toBe('sp-1')
    expect(rel.sourceId).toBe('ev-1')
    expect(rel.type).toBe('belongs_to')
  })

  it('值是名称串时不再按名匹配（证明口径已换成 id，不靠名称碰运气）', async () => {
    const { api } = mk({ name: '赤焰', race: '林族' }, [nameField, raceField])
    api.save()
    await new Promise(r => setTimeout(r, 0))
    expect(putRelation).not.toHaveBeenCalled()
  })

  it('空值清掉既有关系', async () => {
    getRelationsByEntity.mockResolvedValueOnce([{ id: 'rel-old', type: 'belongs_to' }] as never)
    const { api } = mk({ name: '赤焰', race: '' }, [nameField, raceField])
    api.save()
    await vi.waitFor(() => expect(deleteRelation).toHaveBeenCalledWith('rel-old'))
    expect(putRelation).not.toHaveBeenCalled()
  })
})

/** 走一次 save 并取回发出的载荷（emit 签名是 ('save', data)，载荷在第 2 参） */
function savedPayload(formData: Record<string, unknown>, fields: any[]) {
  const { api, emit } = mk(formData, fields)
  api.save()
  expect(emit).toHaveBeenCalledTimes(1)
  expect(emit.mock.calls[0][0]).toBe('save')
  return emit.mock.calls[0][1] as { tags: string[]; properties: Record<string, unknown> }
}

describe('useEntityFormSave —— 值形态收集', () => {
  it('tags 归一成数组且不落进 properties（数组与逗号串两种入口都吃）', () => {
    const tagField = { key: 'tags', label: '标签', type: 'tags' }
    const moodField = { key: 'mood', label: '性格', type: 'text' }
    const fromArray = savedPayload({ name: '甲', tags: ['主角', '斥候'], mood: '沉稳' }, [nameField, tagField, moodField])
    const fromString = savedPayload({ name: '乙', tags: '主角, 已归档' }, [nameField, tagField])

    expect(fromArray.tags).toEqual(['主角', '斥候'])
    expect(fromArray.properties.tags).toBeUndefined()
    expect(fromArray.properties.mood).toBe('沉稳')
    expect(fromString.tags).toEqual(['主角', '已归档'])
  })

  it('multiSelect 保数组形态（不再被收成字符串）', () => {
    const call = savedPayload({ name: '丙', usage: ['炼金', '食用'] }, [
      nameField,
      { key: 'usage', label: '用途', type: 'multiSelect' },
    ])
    expect(call.properties.usage).toEqual(['炼金', '食用'])
  })

  it('必填名为空时不发出 save', () => {
    const err = ref('')
    const emit = vi.fn()
    const api = useEntityFormSave({
      formData: ref({ name: '   ' }),
      nameError: err,
      sortedFields: ref([nameField]),
      entityStore: { entities: [], entityMap: new Map() } as never,
      entity: () => null,
      emit,
    })
    api.save()
    expect(emit).not.toHaveBeenCalled()
    expect(err.value).toContain('不能为空')
  })
})
