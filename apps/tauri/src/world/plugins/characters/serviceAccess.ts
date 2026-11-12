/**
 * characters 芽的服务取值器。
 *
 * 与 notebook / mindmap / data-tools 同一模式：插件经 `world.*` 服务取数（唯一取数
 * 通道，换数据源只改 `services.ts`），收敛成单份避免每文件重复。取不到属时序被
 * 破坏的编程错误（服务在起树时登记，视图由树的注册表驱动挂载），故报错而非静默降级。
 *
 * `undo` / `redo` 收的形参是 `entityStore` / `relationStore` 实例，但 `useUndoRedo`
 * 内部只按鸭子类型调用 `add` / `update` / `remove`——服务对象签名兼容（且 `remove`
 * 多出的 `source` / `opts` 是可选参数），故传 `entitiesSvc()` / `relationsSvc()` 即可。
 */
import { getWorldService } from '../../service-registry'
import type {
  WorldEntitiesService,
  WorldRelationsService,
  WorldSchemaService,
  WorldUiService,
} from '../../services'

export function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[characters] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}

export function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[characters] world.relations 服务未就绪（视图渲染早于起树）')
  return svc
}

export function schemaSvc(): WorldSchemaService {
  const svc = getWorldService<WorldSchemaService>('world.schema')
  if (!svc) throw new Error('[characters] world.schema 服务未就绪（视图渲染早于起树）')
  return svc
}

export function uiSvc(): WorldUiService {
  const svc = getWorldService<WorldUiService>('world.ui')
  if (!svc) throw new Error('[characters] world.ui 服务未就绪（视图渲染早于起树）')
  return svc
}
