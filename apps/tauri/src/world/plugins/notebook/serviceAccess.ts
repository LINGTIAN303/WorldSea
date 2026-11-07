/**
 * notebook 芽的服务取值器。
 *
 * 为什么单独成文件：本插件 10 个文件都要经 `world.*` 服务取数（唯一取数通道，
 * 换数据源只改 `services.ts`），而 `NotebookView.vue` 已在 400 行上限边缘——
 * 每处复制一份 getter 会把它顶出去。收敛到这里同时消掉 10 份重复。
 *
 * 取不到属时序被破坏的编程错误（服务在起树时登记，视图由树的注册表驱动挂载），
 * 故报错而非静默降级——否则表现为「列表莫名是空的」，排查成本极高。
 */
import { getWorldService } from '../../service-registry'
import type { WorldEntitiesService, WorldRelationsService } from '../../services'

export function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[notebook] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}

export function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[notebook] world.relations 服务未就绪（视图渲染早于起树）')
  return svc
}
