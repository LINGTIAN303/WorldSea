/**
 * outline 芽的服务取值器。
 *
 * 与 notebook / custom / theme-editor / mindmap 同一模式：经 `world.*` 服务取数/取配置
 * （唯一通道，换来源只改 `services.ts`），收敛成单份避免每文件重复。取不到属时序被
 * 破坏的编程错误（服务在起树时登记，视图由树的注册表驱动挂载），故报错而非静默降级。
 */
import { getWorldService } from '../../service-registry'
import type { Relation } from '@worldsea/entity-core'
import type { ChapterLinkStore } from '@/entity/chapterLink'
import type { OutlineLinkStore } from '@/entity/outlineLinks'
import type { WorldEntitiesService, WorldFontService, WorldRelationsService } from '../../services'

export function fontSvc(): WorldFontService {
  const svc = getWorldService<WorldFontService>('world.font')
  if (!svc) throw new Error('[outline] world.font 服务未就绪（视图渲染早于起树）')
  return svc
}

export function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[outline] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}

export function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[outline] world.relations 服务未就绪（视图渲染早于起树）')
  return svc
}

/**
 * `@/entity/outlineLinks` 与 `@/entity/chapterLink` 的**最小依赖**是 store 形状
 * （`getAllRelations()` / `getAllEntities()` / `relations` 数组），
 * 而服务把它们收敛成了 `getAll()` / `list()`。
 *
 * 这两个辅助模块同时被 `manuscript` 与项目启动链（`plugins/boot.ts`）复用，
 * 改它的接口会波及服务目录范围之外——故在这里做适配，保持模块不动：
 * - `getAllRelations()` → `relations.getAll()`（同样只读磁盘、不改内存）
 * - `getAllEntities()`  → `entities.getAll()`
 * - `relations`         → `relations.list()` 的响应式引用
 */
export function outlineLinkStore(): OutlineLinkStore {
  const svc = relationsSvc()
  return {
    getAllRelations: () => svc.getAll(),
    add: (relation: Relation) => svc.add(relation),
    remove: (id: string) => svc.remove(id),
  }
}

export function chapterLinkStore(): ChapterLinkStore {
  const svc = entitiesSvc()
  return { getAllEntities: () => svc.getAll() }
}

/** `ChapterRelationStore` 的适配：只需 `relations` 数组 + 写三件（与 relations 服务一致） */
export function chapterRelationStore() {
  const svc = relationsSvc()
  return {
    relations: svc.list(),
    add: svc.add,
    update: svc.update,
    remove: svc.remove,
  }
}
