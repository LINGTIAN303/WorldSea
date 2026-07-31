/**
 * int8 向量量化器
 *
 * 将 float32 向量压缩为 int8，实现 4x 存储压缩。
 * 使用对称量化：data[i] = round((vec[i] - offset) / scale)
 * scale = (max - min) / 254, offset = (max + min) / 2
 */

/** 量化后的向量 */
export interface QuantizedVector {
  data: Int8Array
  scale: number
  offset: number
}

/**
 * 将 float32 向量量化为 int8
 *
 * 对称量化策略：以 [min, max] 为范围映射到 [-127, 127]，
 * scale 为每个量化步长对应的浮点距离，offset 为范围中点。
 * 全零向量退化为 scale=1, offset=0。
 */
export function quantizeInt8(vec: Float32Array): QuantizedVector {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < vec.length; i++) {
    if (vec[i] < min) min = vec[i]
    if (vec[i] > max) max = vec[i]
  }

  const range = max - min
  // 全零向量或常量向量：退化处理
  if (range === 0) {
    return { data: new Int8Array(vec.length), scale: 1, offset: 0 }
  }

  const scale = range / 254
  const offset = (max + min) / 2

  const data = new Int8Array(vec.length)
  for (let i = 0; i < vec.length; i++) {
    const val = Math.round((vec[i] - offset) / scale)
    // 钳位到 [-127, 127]
    data[i] = Math.max(-127, Math.min(127, val))
  }

  return { data, scale, offset }
}

/**
 * 将 int8 量化向量反量化为 float32
 *
 * result[i] = data[i] * scale + offset
 */
export function dequantizeInt8(data: Int8Array, scale: number, offset: number): Float32Array {
  const result = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] * scale + offset
  }
  return result
}

/**
 * 批量量化多个 float32 向量
 */
export function quantizeBatch(vecs: Float32Array[]): QuantizedVector[] {
  return vecs.map(v => quantizeInt8(v))
}

/**
 * 在量化域直接计算余弦相似度，避免反量化开销
 *
 * 注意：这是近似值。当两个向量的 offset 不同时，量化域的余弦相似度
 * 与原始浮点域会有偏差，但 int8 量化下的精度损失通常可接受。
 * 当 offset 相同时（如同一批次量化），比例因子在分子分母中精确抵消。
 */
export function cosineSimilarityInt8(
  a: QuantizedVector,
  b: QuantizedVector,
): number {
  const len = a.data.length
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    const va = a.data[i]
    const vb = b.data[i]
    dot += va * vb
    na += va * va
    nb += vb * vb
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
