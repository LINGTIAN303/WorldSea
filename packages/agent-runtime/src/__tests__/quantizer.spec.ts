import { describe, it, expect } from 'vitest'
import {
  quantizeInt8,
  dequantizeInt8,
  quantizeBatch,
  cosineSimilarityInt8,
} from '../embedding/quantizer'

/** float32 原始余弦相似度计算，用于对比验证 */
function floatCosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

describe('quantizer', () => {
  it('quantizeInt8 应将 float32 向量压缩为 int8', () => {
    const vec = new Float32Array([0.5, -0.3, 0.8, -0.1, 0.0])
    const { data, scale, offset } = quantizeInt8(vec)
    expect(data).toBeInstanceOf(Int8Array)
    expect(data.length).toBe(5)
    expect(scale).toBeGreaterThan(0)
    expect(typeof offset).toBe('number')
  })

  it('dequantizeInt8 应还原到近似原始值（误差 ±0.05）', () => {
    const original = new Float32Array([0.5, -0.3, 0.8, -0.1, 0.0])
    const q = quantizeInt8(original)
    const restored = dequantizeInt8(q.data, q.scale, q.offset)
    for (let i = 0; i < original.length; i++) {
      expect(Math.abs(restored[i] - original[i])).toBeLessThan(0.05)
    }
  })

  it('cosineSimilarityInt8 应与 float32 余弦相似度结果接近（误差 ±0.05）', () => {
    const a = new Float32Array([0.5, -0.3, 0.8, -0.1, 0.0])
    const b = new Float32Array([0.4, -0.2, 0.7, 0.1, 0.1])
    const qa = quantizeInt8(a)
    const qb = quantizeInt8(b)
    const floatScore = floatCosine(a, b)
    const int8Score = cosineSimilarityInt8(qa, qb)
    expect(Math.abs(floatScore - int8Score)).toBeLessThan(0.05)
  })

  it('quantizeBatch 应批量量化', () => {
    const vecs = [
      new Float32Array([0.5, -0.3]),
      new Float32Array([0.1, 0.9]),
    ]
    const batch = quantizeBatch(vecs)
    expect(batch.length).toBe(2)
    expect(batch[0].data.length).toBe(2)
    expect(batch[1].data.length).toBe(2)
  })

  it('全零向量应安全处理（scale=1, data 全为 0）', () => {
    const vec = new Float32Array([0, 0, 0])
    const q = quantizeInt8(vec)
    expect(q.scale).toBe(1)
    expect(q.offset).toBe(0)
    expect(q.data.every(v => v === 0)).toBe(true)
  })
})
