import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  putVectorV2,
  searchSimilarV2,
  getCollectionV2,
  deleteVectorV2,
  getCollectionSizeV2,
  type VectorRecordV2,
} from '../embedding/vector-store-v2'

describe('vector-store-v2', () => {
  const collection = 'test_entities_v2'

  // 每个测试前清理该集合的数据
  beforeEach(async () => {
    const existing = await getCollectionV2(collection)
    for (const r of existing) {
      await deleteVectorV2(r.id)
    }
  })

  it('putVectorV2 应存储量化向量，getCollectionV2 应能检索', async () => {
    const vec = new Float32Array(8)
    for (let i = 0; i < 8; i++) vec[i] = Math.random() - 0.5
    const record: VectorRecordV2 = {
      id: 'entity_test1',
      collection,
      vector: vec,
      metadata: { entityId: 'test1', name: 'Test Entity' },
      updatedAt: Date.now(),
    }
    await putVectorV2(record)
    const loaded = await getCollectionV2(collection)
    expect(loaded.length).toBe(1)
    expect(loaded[0].id).toBe('entity_test1')
  })

  it('searchSimilarV2 应返回按相似度排序的结果', async () => {
    // 构造三个向量：base、similar（接近 base）、different（远离 base）
    const base = new Float32Array(8)
    for (let i = 0; i < 8; i++) base[i] = i * 0.1

    const similar = new Float32Array(8)
    for (let i = 0; i < 8; i++) similar[i] = i * 0.1 + 0.01 // 非常接近 base

    const different = new Float32Array(8)
    for (let i = 0; i < 8; i++) different[i] = -i * 0.1

    await putVectorV2({ id: 'e1', collection, vector: base, metadata: { name: 'base' }, updatedAt: Date.now() })
    await putVectorV2({ id: 'e2', collection, vector: similar, metadata: { name: 'similar' }, updatedAt: Date.now() })
    await putVectorV2({ id: 'e3', collection, vector: different, metadata: { name: 'different' }, updatedAt: Date.now() })

    const results = await searchSimilarV2(base, collection, 3, 0.1)
    expect(results.length).toBeGreaterThanOrEqual(2)
    // base 自身应排第一，similar 应排第二
    expect(results[0].id).toBe('e1')
    expect(results[1].id).toBe('e2')
  })

  it('deleteVectorV2 应删除指定向量', async () => {
    await putVectorV2({ id: 'e_del', collection, vector: new Float32Array(8), metadata: {}, updatedAt: Date.now() })
    const before = await getCollectionSizeV2(collection)
    expect(before).toBeGreaterThanOrEqual(1)
    await deleteVectorV2('e_del')
    const after = await getCollectionSizeV2(collection)
    expect(after).toBe(before - 1)
  })

  it('getCollectionSizeV2 应返回集合大小', async () => {
    const size0 = await getCollectionSizeV2(collection)
    expect(typeof size0).toBe('number')

    await putVectorV2({ id: 'size_test_1', collection, vector: new Float32Array(4), metadata: {}, updatedAt: Date.now() })
    await putVectorV2({ id: 'size_test_2', collection, vector: new Float32Array(4), metadata: {}, updatedAt: Date.now() })
    const size2 = await getCollectionSizeV2(collection)
    expect(size2).toBe(size0 + 2)

    // 清理
    await deleteVectorV2('size_test_1')
    await deleteVectorV2('size_test_2')
  })
})
