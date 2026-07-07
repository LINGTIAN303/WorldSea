/**
 * io_export — 导入/导出工具（新版）
 *
 * 接入 ExportController + ImportController + Serializer 体系。
 * 保留与旧代码兼容的 exportData / parseImportData 接口。
 *
 * 新的核心入口：
 *   exportController.exportToString(format)   → 导出字符串
 *   importController.importPack(pack, strategy) → 导入
 *   exportController.download(format)          → 浏览器下载
 */

import { ExportController, defaultFormatEncoder } from './ExportController'
import { ImportController } from './ImportController'
import { serializerRegistry, type WorldSmithPack } from './WorldSmithPack'
import { entitySerializer, relationSerializer, entityTypeSerializer, relationTypeSerializer, createModuleSerializer, createViewSerializer, customFieldSerializer } from '@worldsmith/entity-core/core'

/* ════════════════════════════════════════
   初始化 — 注册所有 Serializer
   ════════════════════════════════════════ */

function initSerializers(
  customModuleStore?: { modules: any[]; addModule: any; updateModule: any; removeModule: any },
  pluginStore?: { views: any[] },
) {
  serializerRegistry.clear()
  serializerRegistry.register(entitySerializer)
  serializerRegistry.register(relationSerializer)
  serializerRegistry.register(entityTypeSerializer)
  serializerRegistry.register(relationTypeSerializer)
  serializerRegistry.register(customFieldSerializer)

  if (customModuleStore) {
    serializerRegistry.register(createModuleSerializer(
      () => customModuleStore.modules,
      customModuleStore.addModule,
      customModuleStore.updateModule,
      customModuleStore.removeModule,
    ))
  }

  if (pluginStore) {
    serializerRegistry.register(createViewSerializer(
      () => pluginStore.views,
    ))
  }
}

/* ════════════════════════════════════════
   单例
   ════════════════════════════════════════ */

const _exportController = new ExportController()
const _importController = new ImportController()

/* ════════════════════════════════════════
   公开接口 —— 与旧版兼容
   ════════════════════════════════════════ */

// 旧版 ExportData 接口，保留兼容
export interface ExportData {
  version: number
  exportedAt: string
  entities: any[]
  relations: any[]
}

/**
 * 兼容旧接口：exportData(entities, relations, format)
 * 新版建议改用 exportController.exportToString()
 */
export async function exportData(
  entities: any[],
  relations: any[],
  format: 'json' | 'yaml' = 'json',
): Promise<string> {
  initSerializers()
  // 用传入的 entities/relations 覆盖默认 Serializer 的行为
  // 这里直接构造一个简化的 pack
  const pack: WorldSmithPack = {
    manifest: {
      version: 2,
      exportedAt: new Date().toISOString(),
    },
    serializers: {
      entities: { entities, total: entities.length, version: 1 },
      relations: { relations, total: relations.length, version: 1 },
    },
  }
  return defaultFormatEncoder.encode(pack, format)
}

/**
 * 兼容旧接口：parseImportData(text)
 * 新版建议改用 importController.parseImportData()
 */
export function parseImportData(text: string): ExportData {
  const pack = _importController.parseImportData(text)
  const entityData = pack.serializers['entities'] as any
  const relationData = pack.serializers['relations'] as any
  return {
    version: pack.manifest.version,
    exportedAt: pack.manifest.exportedAt,
    entities: entityData?.entities ?? [],
    relations: relationData?.relations ?? [],
  }
}

/**
 * 兼容旧接口：importToDb(data, entityStore, relationStore)
 * 新版建议改用 importController.importPack()
 */
export async function importToDb(
  data: ExportData,
  entityStore: { add: (e: any) => Promise<unknown>; loadAll: () => Promise<void>; clear?: () => Promise<void> },
  relationStore: { add: (r: any) => Promise<unknown>; loadAll: () => Promise<void>; clear?: () => Promise<void> },
) {
  initSerializers()

  if (entityStore.clear) await entityStore.clear()
  for (const e of data.entities) await entityStore.add(e)
  if (relationStore.clear) await relationStore.clear()
  for (const r of data.relations) await relationStore.add(r)
  await entityStore.loadAll()
  await relationStore.loadAll()
}

/**
 * 初始化 Serializers + 返回 controller 实例（供新版 UI 使用）
 */
export function getExportController(
  customModuleStore?: { modules: any[]; addModule: any; updateModule: any; removeModule: any },
  pluginStore?: { views: any[] },
): ExportController {
  initSerializers(customModuleStore, pluginStore)
  return _exportController
}

export function getImportController(): ImportController {
  return _importController
}
