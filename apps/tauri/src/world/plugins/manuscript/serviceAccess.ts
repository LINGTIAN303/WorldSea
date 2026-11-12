/**
 * manuscript 芽的服务取值器。
 *
 * 与 notebook / custom / theme-editor / mindmap / outline 同一模式：经 `world.*` 服务
 * 取数/取配置（唯一通道，换来源只改 `services.ts`），收敛成单份避免每文件重复。
 * 取不到属时序被破坏的编程错误，故报错而非静默降级。
 */
import { getWorldService } from '../../service-registry'
import type { Entity } from '@worldsea/entity-core'
import type {
  WorldEntitiesService,
  WorldFontLibraryService,
  WorldFontService,
  WorldRelationsService,
  WorldSettingsService,
  WorldUiService,
} from '../../services'

export function fontSvc(): WorldFontService {
  const svc = getWorldService<WorldFontService>('world.font')
  if (!svc) throw new Error('[manuscript] world.font 服务未就绪（视图渲染早于起树）')
  return svc
}

export function fontLibrarySvc(): WorldFontLibraryService {
  const svc = getWorldService<WorldFontLibraryService>('world.fontLibrary')
  if (!svc) throw new Error('[manuscript] world.fontLibrary 服务未就绪（视图渲染早于起树）')
  return svc
}

export function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[manuscript] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}

export function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[manuscript] world.relations 服务未就绪（视图渲染早于起树）')
  return svc
}

export function settingsSvc(): WorldSettingsService {
  const svc = getWorldService<WorldSettingsService>('world.settings')
  if (!svc) throw new Error('[manuscript] world.settings 服务未就绪（视图渲染早于起树）')
  return svc
}

export function uiSvc(): WorldUiService {
  const svc = getWorldService<WorldUiService>('world.ui')
  if (!svc) throw new Error('[manuscript] world.ui 服务未就绪（视图渲染早于起树）')
  return svc
}

/**
 * `@/entity/chapterLink` 的最小依赖是 store 形状（`getAllEntities()` / `relations` 数组），
 * 而服务收敛成了 `getAll()` / `list()`。该模块同时被 `outline` 与项目启动链
 * （`plugins/boot.ts`）复用，改它接口会波及服务范围之外——故在此做适配。
 * `getAllEntities()` 对应 `entities.getAll()`（**只读磁盘、不改内存**，与 `reload()` 不同）。
 */
export function chapterLinkStore(): { getAllEntities: () => Promise<Entity[]> } {
  const svc = entitiesSvc()
  return { getAllEntities: () => svc.getAll() }
}

export function chapterRelationStore() {
  const svc = relationsSvc()
  return { relations: svc.list(), add: svc.add, update: svc.update, remove: svc.remove }
}
