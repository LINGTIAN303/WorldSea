/**
 * 本文件从 apps/web/src/core/ 迁入（Phase A 迁移计划：算法/校验复用 WASM）
 * 端分离：WASM 加载与 Worker 池（Tauri 端复用同一 WASM 核心）
 */

/**
 * WASM Worker — 在 Web Worker 中运行 WASM 重计算，避免阻塞 UI 主线程
 *
 * 架构：
 *   主线程 → postMessage({ method, args }) → Worker 加载 WASM 执行 → postMessage({ id, result/error })
 *
 * Worker 内部维持 WorldSeaCore 单例，首次调用时懒加载 WASM 模块。
 * 后续调用直接复用已初始化的实例，无重复初始化开销。
 */

/// Worker 与主线程之间的消息协议
export interface WorkerRequest {
  id: number
  method: string
  args: unknown[]
  /** 可转移入参索引：主线程据此将对应 args 以 Transferable 形式转移（避免结构化克隆复制） */
  transferable?: number[]
}

export interface WorkerResponse {
  id: number
  result?: unknown
  error?: string
}

/// Worker 全局 postMessage（DOM lib 下 `self` 会被解析为 Window，此处显式收窄为 worker 签名）
const workerPost = (self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
}).postMessage.bind(self)

/// WASM 模块类型声明（运行时动态导入，类型宽松处理）
interface WasmModule {
  WorldSeaCore: new () => {
    [method: string]: (...args: any[]) => any
  }
}

let wasmModule: WasmModule | null = null
let wasmInstance: { [method: string]: (...args: any[]) => any } | null = null

/** camelCase → snake_case（Rust wasm-bindgen 默认导出 snake_case 方法名） */
function camelToSnake(name: string): string {
  if (name.includes('_') || name === 'constructor' || name === 'free') return name
  return name.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
}

async function ensureWasm(): Promise<{ [method: string]: (...args: any[]) => any }> {
  if (wasmInstance) return wasmInstance

  try {
    // @ts-ignore — Vite/wasm-pack 动态导入
    wasmModule = await import('@worldsea/core')
    if (!wasmModule?.WorldSeaCore) {
      throw new Error('WASM 模块缺少 WorldSeaCore 导出')
    }
    // Proxy 包装：camelCase 调用自动转发到 snake_case 实际方法
    const raw = new wasmModule.WorldSeaCore()
    wasmInstance = new Proxy(raw, {
      get(target, prop, receiver) {
        if (typeof prop !== 'string') return Reflect.get(target, prop, receiver)
        const snakeName = camelToSnake(prop)
        const val = Reflect.get(target, snakeName, target)
        return typeof val === 'function' ? val.bind(target) : val
      },
    })
    if (typeof wasmInstance.validateEntity !== 'function') {
      throw new Error('WASM 核心库版本不匹配，缺少 validateEntity 方法')
    }
    return wasmInstance
  } catch (e: any) {
    wasmInstance = null
    throw new Error(`WASM Worker 加载失败: ${e?.message || String(e)}`)
  }
}

/// 消息处理
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = e.data

  try {
    const core = await ensureWasm()
    if (typeof core[method] !== 'function') {
      throw new Error(`WASM 方法 "${method}" 不存在`)
    }
    const result = core[method](...args)
    const response: WorkerResponse = { id, result }
    // 若结果是 ArrayBuffer/TypedArray，以 Transferable 形式转移其底层 buffer，避免结构化克隆复制
    if (result instanceof ArrayBuffer) {
      workerPost(response, [result])
    } else if (ArrayBuffer.isView(result)) {
      workerPost(response, [result.buffer])
    } else {
      workerPost(response)
    }
  } catch (err: any) {
    const response: WorkerResponse = {
      id,
      error: err?.message || String(err),
    }
    workerPost(response)
  }
}
