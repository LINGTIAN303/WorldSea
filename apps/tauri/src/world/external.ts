/**
 * 外部插件装载器（批1，2026-10-13）：**运行时来源**（`worlddata/.worldsea/plugins/<id>.js`）。
 *
 * 与构建期静态装载器（`./loader.ts` 的 `import.meta.glob`）互补：本模块负责「读盘 → 求值 → 校验」，
 * 产出与内置插件同形状的 `WorldPlugin`，交给 `./tree.ts` 并入 `available` 装载。
 * 文件形态 = 箭头函数表达式 `(require) => ({ manifest, apply })`（闭包工厂，对齐 dsh-plugin-worldsea-console）。
 * 失败隔离：单文件语法错/清单非法/求值异常只进 `rejected`，其余照常。
 * 求值用 `new Function`——两窗 CSP 均不放 `script-src`（`csp: null` + `CSP_INDEX` 三条指令），已核可执行。
 */
import { validateManifest, type WorldPlugin, type WorldPluginManifest } from './manifest'

/** 外部插件域缺省：manifest 未声明时记 unclassified（不默认归 tool）。 */
export function externalDomain(manifest: WorldPluginManifest): string {
  return manifest.domain?.trim() || 'unclassified'
}
import { createRequire } from './modules'

/** 外部插件 id 强制前缀（内置 `official.*` 不可冒名；`official.` 覆盖意图在此拦下）。 */
export const EXTERNAL_ID_PREFIX = 'ws.'

/** 目录相对路径（相对 `FileStorageBackend.projectDir` = `<工作区>/worlddata`）。 */
export const EXTERNAL_PLUGIN_DIR = '.worldsea/plugins'

export type ExternalEvalResult =
  | { ok: true; manifest: WorldPluginManifest; apply: WorldPlugin['apply'] }
  | { ok: false; reason: string }

/**
 * 求值单个插件文件（**纯函数**，可测核心）：code → 工厂 → 执行 → `{ manifest, apply }`。
 * 任何一步失败都返回可读 `reason`（不抛异常，调用方直接进 rejected）。
 */
export function evaluateExternalPlugin(code: string, require: (name: string) => unknown): ExternalEvalResult {
  let factory: unknown
  try {
    // 文件内容 = 单个箭头函数表达式；外层括号求值（语法错在此暴露）
    factory = new Function(`return (${code})`)()
  } catch (error) {
    return { ok: false, reason: `代码语法错误：${String((error as Error)?.message ?? error)}` }
  }
  if (typeof factory !== 'function') {
    return { ok: false, reason: '文件须为函数表达式 `(require) => ({ manifest, apply })`' }
  }
  let built: unknown
  try {
    built = (factory as (req: unknown) => unknown)(require)
  } catch (error) {
    return { ok: false, reason: `工厂执行抛错：${String((error as Error)?.message ?? error)}` }
  }
  if (!built || typeof built !== 'object') {
    return { ok: false, reason: '工厂返回值不是对象（须 `{ manifest, apply }`）' }
  }
  const plugin = built as Partial<WorldPlugin>
  const check = validateManifest(plugin.manifest)
  if (!check.ok) return { ok: false, reason: check.reason }
  if (typeof plugin.apply !== 'function') return { ok: false, reason: 'apply 缺失（须为函数）' }
  return { ok: true, manifest: check.manifest, apply: plugin.apply as WorldPlugin['apply'] }
}

/* ─── IO 适配（测试注入用；默认 Tauri cmd_fs_*） ─── */

export interface ExternalIo {
  /** 列目录（不存在/失败 = null，不抛） */
  list(dir: string): Promise<Array<{ name: string; isDir: boolean }> | null>
  read(path: string): Promise<string>
}

async function getInvoke(): Promise<((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null> {
  try {
    const api = await import('@tauri-apps/api/core')
    return api.invoke
  } catch {
    return null
  }
}

/** 默认 IO：Tauri 壳命令（与 FileStorageBackend 同一套 cmd_fs_*）。 */
export const tauriExternalIo: ExternalIo = {
  async list(dir) {
    const invoke = await getInvoke()
    if (!invoke) return null
    try {
      const entries = (await invoke('cmd_fs_list', { path: dir, recursive: false })) as Array<{
        name: string
        isDir: boolean
      }>
      return Array.isArray(entries) ? entries : null
    } catch {
      return null
    }
  },
  async read(path) {
    const invoke = await getInvoke()
    if (!invoke) throw new Error('Tauri 环境不可用')
    return invoke('cmd_fs_read', { path, encoding: 'utf-8' }) as Promise<string>
  },
}

/* ─── 收集 ─── */

export interface ExternalCollectReport {
  /** 通过校验的插件（含会被启停关掉的——启停过滤归树/应用侧） */
  plugins: WorldPlugin[]
  rejected: Array<{ id: string; file: string; reason: string }>
  /** id → 源码（重对账指纹对比用） */
  codes: Map<string, string>
}

/** 外部插件目录绝对路径（worlddata 根由调用方传入；空 = 无项目目录，返回 null）。 */
export function externalPluginsDir(projectDir: string | null | undefined): string | null {
  if (!projectDir) return null
  const base = projectDir.replace(/[\\/]+$/, '')
  return `${base}/${EXTERNAL_PLUGIN_DIR}`
}

/**
 * 收集外部插件：列目录 → 逐文件读+求值 → 过校验。
 * 目录不存在 = 空报告（首次未创建，不算错）；单文件失败进 `rejected`（带文件名）。
 */
export async function collectExternalPlugins(
  projectDir: string | null | undefined,
  io: ExternalIo = tauriExternalIo,
): Promise<ExternalCollectReport> {
  const report: ExternalCollectReport = { plugins: [], rejected: [], codes: new Map() }
  const dir = externalPluginsDir(projectDir)
  if (!dir) return report

  const entries = await io.list(dir)
  if (!entries) return report
  const files = entries
    .filter(entry => !entry.isDir && entry.name.endsWith('.js'))
    .map(entry => entry.name)
    .sort()

  const require = createRequire()
  for (const name of files) {
    const file = `${dir}/${name}`
    let code: string
    try {
      code = await io.read(file)
    } catch (error) {
      report.rejected.push({ id: name, file, reason: `文件读取失败：${String((error as Error)?.message ?? error)}` })
      continue
    }
    const result = evaluateExternalPlugin(code, require)
    if (!result.ok) {
      report.rejected.push({ id: name, file, reason: result.reason })
      continue
    }
    const { manifest, apply } = result
    if (!manifest.id.startsWith(EXTERNAL_ID_PREFIX)) {
      report.rejected.push({ id: manifest.id, file, reason: `外部插件 id 须以「${EXTERNAL_ID_PREFIX}」开头（内置 official.* 不可冒名）` })
      continue
    }
    if (manifest.id !== name.replace(/\.js$/, '')) {
      report.rejected.push({ id: manifest.id, file, reason: `id 与文件名不一致（须为 ${manifest.id}.js）` })
      continue
    }
    report.plugins.push({ manifest, apply })
    report.codes.set(manifest.id, code)
  }
  return report
}
