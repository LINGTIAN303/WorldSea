import { describe, it, expect } from 'vitest'
import { quantizeInt8, cosineSimilarityInt8 } from '../embedding/quantizer'
import { packRecords, unpackRecords } from '../embedding/quantizer.worker'

describe('pipeline integration', () => {
  it('完整量化→搜索流程应正确工作', () => {
    // 模拟 5 个 8 维向量
    const vectors = Array.from({ length: 5 }, (_, i) => {
      const v = new Float32Array(8)
      for (let j = 0; j < 8; j++) v[j] = Math.sin(i * 0.5 + j * 0.3)
      return v
    })
    const quantized = vectors.map(v => quantizeInt8(v))
    const query = quantized[0]
    const scores = quantized.map(q => cosineSimilarityInt8(query, q))
    // 自身相似度应最高
    const maxIdx = scores.indexOf(Math.max(...scores))
    expect(maxIdx).toBe(0)
    expect(scores[0]).toBeGreaterThan(0.9)
  })

  it('pack/unpack 应在管线中保持数据完整', () => {
    const records = Array.from({ length: 3 }, (_, i) => ({
      id: `entity_${i}`,
      collection: 'entities',
      data: quantizeInt8(new Float32Array([i * 0.1, -i * 0.2, i * 0.3])).data,
      scale: 0.01,
      offset: 0.5,
      metadata: { name: `Entity ${i}` },
    }))
    const packed = packRecords(records)
    const unpacked = unpackRecords(packed)
    expect(unpacked.length).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(unpacked[i].id).toBe(`entity_${i}`)
      expect(unpacked[i].metadata.name).toBe(`Entity ${i}`)
    }
  })

  it('量化压缩比应达到 4x', () => {
    const vec = new Float32Array(1536) // 标准 embedding 维度
    for (let i = 0; i < 1536; i++) vec[i] = Math.random() - 0.5
    const originalBytes = vec.byteLength          // 1536 * 4 = 6144
    const quantized = quantizeInt8(vec)
    const quantizedBytes = quantized.data.byteLength  // 1536 * 1 = 1536
    expect(quantizedBytes).toBe(originalBytes / 4)
  })
})
