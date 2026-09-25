/**
 * 第二棵树的插件装载器（B，2026-09-25）：**构建期静态清单**（`import.meta.glob`）+ 预检 + 失败隔离。
 *
 * - 清单来源：`./plugins/<id>/index.ts` 的 `default` 导出（rolldown 静态分析 → 按插件分包，零运行时 IO）。
 * - `requires` 语义 = **服务名**：装载前按本树声明的服务表预检（缺失即拒、给可读原因）；
 *   运行期再交给 cordis 的 `inject`（服务就绪才 apply）。
 * - 失败隔离：单个插件模块导入失败/清单非法/依赖缺失，只记录该条，其余照常装载。
 */
import { validateManifest, type WorldPlugin } from './manifest'

export interface LoadReport {
  /** 通过校验并已交给树的插件 id（按装载顺序） */
  loaded: string[]
  /** 被拒条目（id 可能缺失 → 用文件路径） */
  rejected: Array<{ id: string; reason: string }>
}

export interface AssembleResult {
  accepted: WorldPlugin[]
  report: LoadReport
}

/**
 * 校验 + 预检 + 去重（**纯函数**，装载器的可测核心）。
 * @param candidates 候选插件（装载器从 glob 结果摊平得到；`undefined` = 模块无 default 导出）
 * @param services 本树已声明的服务名（预检 `requires` 用）
 */
export function assemblePlugins(
  candidates: Array<{ file: string; plugin?: unknown }>,
  services: string[],
): AssembleResult {
  const accepted: WorldPlugin[] = []
  const report: LoadReport = { loaded: [], rejected: [] }
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const fallbackId = candidate.file
    if (!candidate.plugin || typeof candidate.plugin !== 'object') {
      report.rejected.push({ id: fallbackId, reason: '模块无 default 导出（插件须 `export default { manifest, apply }`）' })
      continue
    }
    const plugin = candidate.plugin as Partial<WorldPlugin>
    const check = validateManifest(plugin.manifest)
    if (!check.ok) {
      report.rejected.push({ id: fallbackId, reason: check.reason })
      continue
    }
    if (typeof plugin.apply !== 'function') {
      report.rejected.push({ id: check.manifest.id, reason: 'apply 缺失（须为函数）' })
      continue
    }
    if (seen.has(check.manifest.id)) {
      report.rejected.push({ id: check.manifest.id, reason: 'id 重复（先到者生效）' })
      continue
    }
    const missing = (check.manifest.requires ?? []).filter(service => !services.includes(service))
    if (missing.length > 0) {
      report.rejected.push({ id: check.manifest.id, reason: `本树未提供依赖服务：${missing.join(' / ')}` })
      continue
    }
    seen.add(check.manifest.id)
    accepted.push({ manifest: check.manifest, apply: plugin.apply as WorldPlugin['apply'] })
    report.loaded.push(check.manifest.id)
  }

  return { accepted, report }
}

/** 扫 `plugins/〈id〉/index.ts`（懒加载：每个插件独立分包，起树时才拉取）。 */
const pluginModules = import.meta.glob<{ default?: unknown }>('./plugins/*/index.ts')

/** 装载全部树插件：拉取模块 → 校验 → 交付树（返回接受列表与报告）。 */
export async function collectWorldPlugins(services: string[]): Promise<AssembleResult> {
  const files = Object.keys(pluginModules).sort()
  const candidates: Array<{ file: string; plugin?: unknown }> = []
  const rejected: LoadReport['rejected'] = []

  const settled = await Promise.allSettled(files.map(file => pluginModules[file]()))
  settled.forEach((result, index) => {
    const file = files[index]
    if (result.status === 'fulfilled') {
      candidates.push({ file, plugin: (result.value as { default?: unknown })?.default })
    } else {
      rejected.push({ id: file, reason: `模块导入失败：${String(result.reason)}` })
    }
  })

  const assembled = assemblePlugins(candidates, services)
  return { accepted: assembled.accepted, report: { loaded: assembled.report.loaded, rejected: [...rejected, ...assembled.report.rejected] } }
}
