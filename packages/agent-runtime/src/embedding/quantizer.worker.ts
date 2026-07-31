/**
 * Web Worker：量化向量搜索
 *
 * 在独立线程中执行量化向量的余弦相似度搜索，不阻塞 UI。
 * 支持通过 postMessage 加载序列化记录和执行搜索。
 */

import { cosineSimilarityInt8, type QuantizedVector } from './quantizer'

/** 量化向量记录 */
export interface QuantizedVectorRecord {
  id: string
  collection: string
  data: Int8Array
  scale: number
  offset: number
  metadata: Record<string, any>
}

/** 序列化后的可传输记录集（所有 int8 数据连续存储在一个 ArrayBuffer 中） */
export interface PackedRecords {
  ids: string[]
  collections: string[]
  data: ArrayBuffer
  scales: Float32Array
  offsets: Float32Array
  metadataJson: string
  dim: number
  count: number
}

/** 搜索消息 */
export interface SearchMessage {
  type: 'search'
  queryData: Int8Array
  queryScale: number
  queryOffset: number
  collection: string
  topK: number
  minScore: number
}

/** 加载消息 */
export interface LoadMessage {
  type: 'load'
  packed: PackedRecords
}

/** 搜索结果 */
export interface SearchResult {
  id: string
  score: number
  metadata: Record<string, any>
}

/** 内存中的记录存储 */
let store: QuantizedVectorRecord[] = []

/**
 * 将记录序列化为可传输格式
 * 所有 int8 数据连续存储在一个 ArrayBuffer 中，便于 Worker 间零拷贝传输
 */
export function packRecords(records: QuantizedVectorRecord[]): PackedRecords {
  const dim = records.length > 0 ? records[0].data.length : 0
  const count = records.length
  const totalLen = dim * count
  const dataBuf = new Int8Array(totalLen)
  const scales = new Float32Array(count)
  const offsets = new Float32Array(count)
  const ids: string[] = []
  const collections: string[] = []
  const metadataArr: Record<string, any>[] = []

  for (let i = 0; i < count; i++) {
    const r = records[i]
    dataBuf.set(r.data, i * dim)
    scales[i] = r.scale
    offsets[i] = r.offset
    ids.push(r.id)
    collections.push(r.collection)
    metadataArr.push(r.metadata)
  }

  return {
    ids,
    collections,
    data: dataBuf.buffer,
    scales,
    offsets,
    metadataJson: JSON.stringify(metadataArr),
    dim,
    count,
  }
}

/**
 * 将序列化格式反序列化为记录数组
 */
export function unpackRecords(packed: PackedRecords): QuantizedVectorRecord[] {
  const { ids, collections, data, scales, offsets, metadataJson, dim, count } = packed
  const dataArr = new Int8Array(data)
  const metadataArr = JSON.parse(metadataJson) as Record<string, any>[]
  const records: QuantizedVectorRecord[] = []

  for (let i = 0; i < count; i++) {
    const recordData = dataArr.slice(i * dim, (i + 1) * dim)
    records.push({
      id: ids[i],
      collection: collections[i],
      data: recordData,
      scale: scales[i],
      offset: offsets[i],
      metadata: metadataArr[i] || {},
    })
  }

  return records
}

/**
 * 处理搜索请求：在已加载的记录中查找与查询向量最相似的 topK 个结果
 */
function handleSearch(msg: SearchMessage): SearchResult[] {
  const query: QuantizedVector = {
    data: msg.queryData,
    scale: msg.queryScale,
    offset: msg.queryOffset,
  }

  // 按集合过滤候选记录
  const candidates = store.filter(r => r.collection === msg.collection)
  const scored: SearchResult[] = []

  for (const r of candidates) {
    const score = cosineSimilarityInt8(query, {
      data: r.data,
      scale: r.scale,
      offset: r.offset,
    })
    if (score >= msg.minScore) {
      scored.push({ id: r.id, score, metadata: r.metadata })
    }
  }

  // 按相似度降序排列
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, msg.topK)
}

/**
 * 处理加载请求：将序列化记录解包到内存存储
 */
function handleLoad(msg: LoadMessage): void {
  store = unpackRecords(msg.packed)
}

// Worker 消息处理：仅在 Worker 环境中激活
declare const WorkerGlobalScope: typeof globalThis
if (typeof globalThis !== 'undefined' && typeof self !== 'undefined' && typeof (self as any).onmessage !== 'undefined') {
  ;(self as any).onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'search') {
      const results = handleSearch(msg as SearchMessage)
      ;(self as any).postMessage({ type: 'search_result', results })
    } else if (msg.type === 'load') {
      handleLoad(msg as LoadMessage)
      ;(self as any).postMessage({ type: 'load_done', count: store.length })
    }
  }
}
