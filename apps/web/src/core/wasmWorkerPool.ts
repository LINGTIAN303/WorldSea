/**
 * 本文件于 Phase 3 从 src/core/ 迁移到 apps/web/src/core/
 * 端分离：Web 端专用（WASM 加载与 Worker 池）
 */

/**
 * WASM Worker 池 — 管理多个 Web Worker 执行 WASM 重计算
 *
 * 设计要点：
 * 1. 懒初始化 — 首次调用时创建 Worker
 * 2. 任务队列 — Worker 忙时自动排队，空闲后按序消费
 * 3. 自动回退 — Worker 创建失败或 WASM 加载失败时，回退到主线程同步调用
 * 4. 可取消 — 返回 Promise，支持 AbortController 取消（标记忽略结果）
 *
 * 标记为"重计算"的方法走 Worker，轻量方法仍在主线程：
 * - Heavy: algoForceLayout, algoDijkstraPath, algoAstar, algoTopologicalSort,
 *   algoConnectedComponents, algoTarjanScc, algoPageRank, algoCommunityDetection,
 *   algoBetweennessCentrality, algoTerrainHeightmapGenerate, algoHydraulicErosion,
 *   algoViewshed, algoConstraintSolve, runDiagnostics, validatePack,
 *   algoDxfParse, algoPolygonBoolean
 * - Light (主线程): algoSegmentIntersect, algoPointInPolygon, algoPolygonArea, etc.
 */

import type { WorkerRequest, WorkerResponse } from './wasm.worker'

// ─── Worker 池单例 ───

const WORKER_COUNT = Math.min(navigator.hardwareConcurrency || 2, 4)

interface WorkerEntry {
  worker: Worker
  busy: boolean
}

let pool: WorkerEntry[] = []
let poolInitAttempted = false

/** 判断当前环境是否支持 Worker + WASM（仅浏览器环境） */
function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof window !== 'undefined'
}

/** 初始化 Worker 池 */
function initPool(): void {
  if (pool.length > 0 || poolInitAttempted) return
  poolInitAttempted = true

  try {
    for (let i = 0; i < WORKER_COUNT; i++) {
      const worker = new Worker(
        new URL('./wasm.worker.ts', import.meta.url),
        { type: 'module', name: `wasm-worker-${i}` },
      )
      pool.push({ worker, busy: false })
    }
    console.log(`[WasmWorkerPool] 初始化 ${pool.length} 个 Worker`)
  } catch (e) {
    console.warn('[WasmWorkerPool] Worker 创建失败，回退到主线程:', e)
    pool = []
  }
}

// ─── 任务队列 ───

interface PendingTask {
  method: string
  args: unknown[]
  resolve: (value: unknown) => void
  reject: (reason: any) => void
}

let taskQueue: PendingTask[] = []
let nextTaskId = 1

/** 从队列取下一个任务派发给空闲 Worker */
function drainQueue(): void {
  while (taskQueue.length > 0) {
    const entry = pool.find(e => !e.busy)
    if (!entry) break

    const task = taskQueue.shift()!
    dispatchToWorker(entry, task)
  }
}

/** 向指定 Worker 派发任务 */
function dispatchToWorker(entry: WorkerEntry, task: PendingTask): void {
  entry.busy = true
  const taskId = nextTaskId++

  const handleMessage = (e: MessageEvent<WorkerResponse>) => {
    if (e.data.id !== taskId) return
    entry.worker.removeEventListener('message', handleMessage)
    entry.busy = false

    if (e.data.error) {
      task.reject(new Error(e.data.error))
    } else {
      task.resolve(e.data.result)
    }

    // 处理队列中下一个任务
    drainQueue()
  }

  entry.worker.addEventListener('message', handleMessage)

  const request: WorkerRequest = { id: taskId, method: task.method, args: task.args }
  entry.worker.postMessage(request)
}

// ─── 重计算方法集合 ───

const HEAVY_METHODS = new Set([
  // 图算法
  'algoForceLayout',
  'algoDijkstraPath',
  'algoAstar',
  'algoTopologicalSort',
  'algoConnectedComponents',
  'algoTarjanScc',
  'algoPageRank',
  'algoCommunityDetection',
  'algoBetweennessCentrality',
  // 地形
  'algoTerrainHeightmapGenerate',
  'algoHydraulicErosion',
  'algoViewshed',
  // 约束求解
  'algoConstraintSolve',
  // 诊断
  'runDiagnostics',
  'validatePack',
  'validateEntities',
  // DXF
  'algoDxfParse',
  // 多边形布尔
  'algoPolygonBoolean',
])

/** 判断某方法是否属于重计算，应走 Worker */
export function isHeavyMethod(method: string): boolean {
  return HEAVY_METHODS.has(method)
}

// ─── 公开 API ───

/**
 * 通过 Worker 池执行 WASM 方法
 *
 * @returns Promise<unknown> — 方法执行结果（已反序列化）
 * 如果 Worker 池不可用，自动回退到主线程同步调用
 */
export async function callViaWorker(
  method: string,
  args: unknown[],
  fallbackFn?: () => any,
): Promise<unknown> {
  // 非浏览器环境或 Worker 不可用 → 回退
  if (!canUseWorker()) {
    if (fallbackFn) return fallbackFn()
    throw new Error(`Worker 不可用，且无回退函数: ${method}`)
  }

  initPool()

  // Worker 池为空（创建失败） → 回退
  if (pool.length === 0) {
    if (fallbackFn) return fallbackFn()
    throw new Error(`Worker 池为空，且无回退函数: ${method}`)
  }

  return new Promise<unknown>((resolve, reject) => {
    taskQueue.push({ method, args, resolve, reject })
    drainQueue()
  })
}

/**
 * 销毁所有 Worker（热更新/测试时使用）
 */
export function terminatePool(): void {
  for (const entry of pool) {
    entry.worker.terminate()
  }
  pool = []
  poolInitAttempted = false
  taskQueue = []
}
