/**
 * Python 微服务桥接 — 启动/健康检查/请求转发
 *
 * Phase 4 迁移：从 worldsmith-server/python-bridge.ts 迁入 apps/cli。
 * 端无关（仅依赖 fetch API），可在 CLI serve 模式下复用。
 *
 * 连接三个 Python 微服务：Crawl4AI、MarkItDown、TurboVec
 */

/** 单个服务的配置 */
export interface ServiceConfig {
  port: number
  enabled: boolean
}

/** 三个 Python 微服务的桥接配置 */
export interface BridgeConfig {
  crawl4ai: ServiceConfig
  markitdown: ServiceConfig
  turbovec: ServiceConfig
}

/** 默认端口映射 */
const DEFAULT_PORTS: Record<keyof BridgeConfig, number> = {
  crawl4ai: 8101,
  markitdown: 8102,
  turbovec: 8103,
}
/**
 * 解析原始配置对象为 BridgeConfig，缺失的服务使用默认值（端口默认，enabled 默认 false）
 * @param raw 原始配置，键为服务名，值为 { port, enabled }
 */
export function parseServiceConfig(
  raw: Record<string, { port: number; enabled: boolean }>,
): BridgeConfig {
  const services: (keyof BridgeConfig)[] = ['crawl4ai', 'markitdown', 'turbovec']
  const config = {} as BridgeConfig

  for (const svc of services) {
    const entry = raw[svc]
    config[svc] = entry
      ? { port: entry.port, enabled: entry.enabled }
      : { port: DEFAULT_PORTS[svc], enabled: false }
  }

  return config
}

/**
 * Python 微服务桥接类
 * 负责构造服务 URL、检查启用状态、健康检查、请求转发
 */
export class PythonBridge {
  private config: BridgeConfig

  constructor(config: BridgeConfig) {
    this.config = config
  }
  /**
   * 获取指定服务的根 URL
   * @param service 服务名（crawl4ai / markitdown / turbovec）
   * @returns 如 http://localhost:8101
   */
  getServiceUrl(service: keyof BridgeConfig): string {
    return `http://localhost:${this.config[service].port}`
  }

  /**
   * 检查指定服务是否在配置中启用
   * @param service 服务名
   */
  isServiceEnabled(service: keyof BridgeConfig): boolean {
    return this.config[service].enabled
  }

  /**
   * 对指定服务执行健康检查（GET /health）
   * 服务未启用时直接返回 false
   * @param service 服务名
   */
  async healthCheck(service: keyof BridgeConfig): Promise<boolean> {
    if (!this.isServiceEnabled(service)) return false
    try {
      const resp = await fetch(`${this.getServiceUrl(service)}/health`)
      return resp.ok
    } catch {
      return false
    }
  }
  /**
   * 向指定服务发送 POST 请求
   * @param service 服务名
   * @param path 请求路径（如 /crawl）
   * @param body 请求体（将被 JSON 序列化）
   * @returns 服务端返回的 JSON 数据
   */
  async request(service: keyof BridgeConfig, path: string, body: any): Promise<any> {
    const url = `${this.getServiceUrl(service)}${path}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`${service} 服务错误 (${resp.status}): ${text}`)
    }
    return resp.json()
  }
}