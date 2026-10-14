/**
 * 项目级 schema 覆盖装载器（批7，2026-10-14）：`worlddata/.worldsea/schemas/<type>.json`。
 *
 * 与外部插件装载器（./external.ts）互补：读盘 → 校验 → 写入覆盖存储（entity-core overlayStore）
 * → 对受影响 type 的持有插件 unload→load 重跑 apply（apply 里 registerEntityV2 自动吃到深合并）。
 * 失败隔离：单文件坏 JSON/校验拒绝只进 rejected，其余照常；文件消失 → 对应 type 回落内置默认。
 * IO 复用外部装载器的 Tauri cmd_fs_* 适配（零 Rust 改动）。
 */
import { entitySchemaRegistryV2, getFileStorageBackend, setSchemaOverlays, validateSchemaOverlay, type EntitySchemaOverlay } from '@worldsea/entity-core'
import { tauriExternalIo, type ExternalIo } from './external'
import { setPluginEnabled, worldTreeState } from './tree'

/** 目录相对路径（相对 FileStorageBackend.projectDir = `<工作区>/worlddata`）。 */
export const SCHEMA_DIR = '.worldsea/schemas'

/** schema 覆盖目录绝对路径（worlddata 根由调用方传入；空 = 无项目目录）。 */
export function projectSchemasDir(projectDir: string | null | undefined): string | null {
  if (!projectDir) return null
  const base = projectDir.replace(/[\\/]+$/, '')
  return `${base}/${SCHEMA_DIR}`
}

export interface SchemaCollectReport {
  /** type → 已校验覆盖（本次读盘全量） */
  overlays: Map<string, EntitySchemaOverlay>
  rejected: Array<{ type: string; file: string; reason: string }>
}

/** 收集 + 校验（注入式 IO 可测核心；目录不存在 = 空覆盖，不报错） */
export async function collectProjectSchemas(io: ExternalIo, dir: string): Promise<SchemaCollectReport> {
  const overlays = new Map<string, EntitySchemaOverlay>()
  const rejected: SchemaCollectReport['rejected'] = []
  const entries = await io.list(dir).catch(() => null)
  if (!entries) return { overlays, rejected }
  for (const entry of entries) {
    if (entry.isDir || !entry.name.endsWith('.json')) continue
    const type = entry.name.replace(/\.json$/, '')
    let raw: unknown
    try {
      raw = JSON.parse(await io.read(`${dir}/${entry.name}`))
    } catch (err) {
      rejected.push({ type, file: entry.name, reason: `JSON 解析失败：${String((err as Error)?.message ?? err)}` })
      continue
    }
    const check = validateSchemaOverlay(raw, type)
    if (!check.ok) {
      rejected.push({ type, file: entry.name, reason: check.errors.join('；') })
      continue
    }
    overlays.set(type, check.value)
  }
  return { overlays, rejected }
}

export interface SchemaReloadReport {
  /** 本次生效的覆盖 type 全集（文件被删的 type 不在其中 = 回落内置默认） */
  applied: string[]
  /** 因覆盖变更而 unload→load 重跑 apply 的插件 */
  replayed: string[]
  rejected: SchemaCollectReport['rejected']
}

/** 上次生效的覆盖 type 集（识别「文件被删 → 回落内置」的重放对象） */
let lastAppliedTypes = new Set<string>()

/** 重载：读盘 → 对账覆盖存储 → 对受影响 type 的持有插件重跑 apply（热生效） */
export async function reloadProjectSchemas(io: ExternalIo = tauriExternalIo, projectDir?: string | null): Promise<SchemaReloadReport> {
  const report: SchemaReloadReport = { applied: [], replayed: [], rejected: [] }
  const fsb = getFileStorageBackend()
  const dir = projectSchemasDir(projectDir ?? fsb?.projectDir ?? null)
  if (!dir) return report

  const { overlays, rejected } = await collectProjectSchemas(io, dir)
  report.rejected = rejected

  // 受影响 type = 本次生效 ∪ 上次生效（后者含「文件被删 → 回落内置」）
  const affected = new Set<string>([...overlays.keys(), ...lastAppliedTypes])
  setSchemaOverlays(overlays)
  report.applied = [...overlays.keys()]
  lastAppliedTypes = new Set(overlays.keys())

  // 重放受影响 type 的持有插件（unload→load 重跑 apply；registry 无基座 = 覆盖留待插件注册时合并）
  const pluginIds = new Set<string>()
  for (const type of affected) {
    const pluginId = entitySchemaRegistryV2.get(type)?.pluginId
    if (pluginId) pluginIds.add(pluginId)
  }
  for (const id of pluginIds) {
    const wasLoaded = worldTreeState().plugins.includes(id)
    setPluginEnabled(id, false)
    if (wasLoaded) setPluginEnabled(id, true)
    report.replayed.push(id)
  }
  return report
}
