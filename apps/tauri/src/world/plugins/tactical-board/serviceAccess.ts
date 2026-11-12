/**
 * tactical-board 芽的服务取值器。
 *
 * 与 notebook / mindmap / data-tools / characters / timeline / outline / manuscript 同一模式：
 * 插件经 `world.*` 服务取数（唯一取数通道，换数据源只改 `services.ts`），收敛成单份避免
 * 每文件重复。取不到属时序被破坏的编程错误（服务在起树时登记，视图由树的注册表驱动挂载），
 * 故报错而非静默降级。
 */
import { getWorldService } from '../../service-registry'
import type { WorldEntitiesService } from '../../services'

export function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[tactical-board] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}
