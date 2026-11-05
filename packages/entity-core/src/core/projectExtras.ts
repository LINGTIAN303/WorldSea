/**
 * 项目级附加扩展点：芽把需要随项目迁移的配置注册进来，核心导出/导入时统一搬运。
 *
 * 两条链共用本注册表：
 * - ProjectFS 目录导出/导入（`settings/timeline.json` 这类文件）；
 * - WorldSeaPack 打包导出/导入（`timeline` 这类 serializer 分区）。
 *
 * 【可撤销，2026-11-05】两个 `register*` 现返回 disposer：插件卸载时能真正撤登记，
 * 而不是把条目永久留在全局表里。见 docs/plans/2026-11-05-阶段1A-状态归属划分.md。
 */
import type { Serializer } from './serializers/types'

const packSerializers = new Map<string, Serializer>()

/**
 * 注册打包分区序列化器（需早于 initSerializers 调用）。
 * @param serializer 分区序列化器。
 * @returns 撤登记函数：仅当该 id 仍指向本次注册的实现时才删除，
 *   避免重载时旧实例的 disposer 误删新实例。
 */
export function registerPackSerializer(serializer: Serializer): () => void {
  packSerializers.set(serializer.id, serializer)
  return () => {
    if (packSerializers.get(serializer.id) === serializer) packSerializers.delete(serializer.id)
  }
}

export function getExtraPackSerializers(): Serializer[] {
  return [...packSerializers.values()]
}

export interface ProjectExtraFile {
  /** 相对项目根的文件路径（正斜杠） */
  path: string
  content: string
}

export interface ProjectExtraProvider {
  id: string
  /** 相对项目根的文件路径（正斜杠） */
  path: string
  exportFile(): ProjectExtraFile | null | Promise<ProjectExtraFile | null>
  importFile(content: string): Promise<void>
}

const extraProviders = new Map<string, ProjectExtraProvider>()

/**
 * 注册项目级附加文件提供方。
 * @param provider 提供方（id 唯一，同 id 覆盖）。
 * @returns 撤登记函数（同 `registerPackSerializer` 的身份校验语义）。
 */
export function registerProjectExtraProvider(provider: ProjectExtraProvider): () => void {
  extraProviders.set(provider.id, provider)
  return () => {
    if (extraProviders.get(provider.id) === provider) extraProviders.delete(provider.id)
  }
}

export function getProjectExtraProviders(): ProjectExtraProvider[] {
  return [...extraProviders.values()]
}
