import {
  serializerRegistry,
  PACK_VERSION,
  type WorldSeaPack,
  type ImportStrategy,
  type ImportReport,
} from './WorldSeaPack'
import { PackageBuilder } from './PackageBuilder'
import { getPackValidator } from './ioServices'

/** 统一导入调度器（按依赖顺序拓扑排序恢复 WorldSeaPack，支持 overwrite/merge），详细见 docs/details/注释/packages/entity-core/core/io/ImportController.md */
export class ImportController {
  /**
   * 导入数据包
   */
  async importPack(
    pack: WorldSeaPack,
    strategy: ImportStrategy = 'overwrite',
  ): Promise<ImportReport> {
    const report: ImportReport = {
      success: true,
      startedAt: new Date().toISOString(),
      completedAt: '',
      items: [],
      strategy,
    }

    // 版本检查
    if (pack.manifest.version > PACK_VERSION) {
      report.success = false
      report.completedAt = new Date().toISOString()
      report.items.push({
        serializerId: '__version__',
        total: 1,
        added: 0,
        skipped: 1,
        updated: 0,
        errors: [
          `包版本 ${pack.manifest.version} 高于当前支持版本 ${PACK_VERSION}，请升级 WorldSea`,
        ],
      })
      return report
    }

    // 版本迁移管道
    let migratedData = pack.serializers
    if (pack.manifest.version < PACK_VERSION) {
      migratedData = await this.runMigration(pack.manifest.version, pack.serializers)
    }

    // Phase 8a：通过 PackValidator 接口校验（不再直接 import coreBackend）
    const validator = getPackValidator()
    const packReport = await validator.validatePack(JSON.stringify(pack))
    if (packReport && !packReport.valid) {
      const errs = packReport.errors.filter(e => e.severity === 'error').map(e => e.message)
      if (errs.length) {
        console.warn('[ImportController] 包验证问题:', errs.join('; '))
      }
    }

    // 按依赖顺序执行导入
    const serializers = serializerRegistry.getSorted()

    for (const s of serializers) {
      const data = migratedData[s.id]
      if (data === undefined) {
        console.log(`[ImportController] 跳过 ${s.id}（包中无数据）`)
        continue
      }
      try {
        const result = await s.import(data as Record<string, unknown>, strategy)
        if (result && typeof result === 'object' && 'serializerId' in result) {
          report.items.push(result)
        } else {
          const d = data as any
          report.items.push({
            serializerId: s.id,
            total: d?.total ?? d?.entities?.length ?? d?.schemas?.length ?? d?.modules?.length ?? 0,
            added: d?.total ?? d?.entities?.length ?? d?.schemas?.length ?? d?.modules?.length ?? 0,
            skipped: 0,
            updated: 0,
            errors: [],
          })
        }
      } catch (err: any) {
        report.items.push({
          serializerId: s.id,
          total: 1,
          added: 0,
          skipped: 0,
          updated: 0,
          errors: [err.message],
        })
        report.success = false
      }
    }

    report.completedAt = new Date().toISOString()
    return report
  }

  /**
   * 版本迁移：将旧版本数据迁移到当前版本格式
   */
  private async runMigration(
    fromVersion: number,
    serializers: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    console.log(`[ImportController] 版本迁移 ${fromVersion} → ${PACK_VERSION}`)
    // v1 → v2: 结构无变化，v1 的 serializers 中 entities/relations 直接可用
    // 后续版本在此添加迁移步骤
    return serializers
  }

  /**
   * 从 Blob 解析导入数据（自动识别 .ws ZIP 或 JSON/YAML 文本）
   */
  async parseImportBlob(blob: Blob): Promise<WorldSeaPack> {
    // 先尝试作为 .ws ZIP 包解析
    try {
      const { pack } = await PackageBuilder.extractPack(blob)
      return pack
    } catch {
      // 不是 ZIP，当文本处理
    }

    const text = await blob.text()
    return await this.parseImportData(text)
  }

  /**
   * 从文本解析导入数据
   *
   * 注：js-yaml 改为动态 import，避免进入首屏 bundle（仅 YAML 导入时才加载）
   */
  async parseImportData(text: string): Promise<WorldSeaPack> {
    // 先尝试 JSON
    try {
      const data = JSON.parse(text) as WorldSeaPack
      if (data.manifest && data.serializers) return data
    } catch { /* not JSON */ }

    // 再尝试 YAML（动态加载 js-yaml）
    try {
      const yaml = await import('js-yaml')
      const data = yaml.load(text) as unknown as WorldSeaPack
      if (data && typeof data === 'object' && 'manifest' in data && 'serializers' in data) return data
    } catch { /* not YAML */ }

    // 兼容旧格式（v1: 直接 { version, exportedAt, entities, relations }）
    try {
      const old = JSON.parse(text) as any
      if (old.entities && old.relations) {
        return {
          manifest: {
            version: 1,
            exportedAt: old.exportedAt ?? new Date().toISOString(),
          },
          serializers: {
            entities: { entities: old.entities, total: old.entities.length, version: 1 },
            relations: { relations: old.relations, total: old.relations.length, version: 1 },
          },
        }
      }
    } catch { /* not old format */ }

    throw new Error('无法解析导入文件：格式不兼容')
  }
}

/** 全局单例 */
export const importController = new ImportController()
