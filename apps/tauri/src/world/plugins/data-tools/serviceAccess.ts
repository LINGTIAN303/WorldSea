/**
 * data-tools 芽的服务取值器。
 *
 * 与 notebook / mindmap / outline 同一模式：插件经 `world.*` 服务取数（唯一取数通道，
 * 换数据源只改 `services.ts`），收敛成单份避免每文件重复。取不到属时序被破坏的
 * 编程错误（服务在起树时登记，视图由树的注册表驱动挂载），故报错而非静默降级。
 */
import { getWorldService } from '../../service-registry'
import type { WorldEntitiesService, WorldRelationsService, WorldTrashService } from '../../services'

export function trashSvc(): WorldTrashService {
  const svc = getWorldService<WorldTrashService>('world.trash')
  if (!svc) throw new Error('[data-tools] world.trash 服务未就绪（面板渲染早于起树）')
  return svc
}

export function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[data-tools] world.entities 服务未就绪（面板渲染早于起树）')
  return svc
}

export function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[data-tools] world.relations 服务未就绪（面板渲染早于起树）')
  return svc
}
