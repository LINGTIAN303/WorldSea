/**
 * 项目级附加扩展点：芽把需要随项目迁移的配置注册进来，核心导出/导入时统一搬运。
 *
 * 两条链共用本注册表：
 * - ProjectFS 目录导出/导入（`settings/timeline.json` 这类文件）；
 * - WorldSeaPack 打包导出/导入（`timeline` 这类 serializer 分区）。
 */
import type { Serializer } from './serializers/types'

const packSerializers = new Map<string, Serializer>()

/** 注册打包分区序列化器（需早于 initSerializers 调用） */
export function registerPackSerializer(serializer: Serializer): void {
  packSerializers.set(serializer.id, serializer)
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

export function registerProjectExtraProvider(provider: ProjectExtraProvider): void {
  extraProviders.set(provider.id, provider)
}

export function getProjectExtraProviders(): ProjectExtraProvider[] {
  return [...extraProviders.values()]
}
