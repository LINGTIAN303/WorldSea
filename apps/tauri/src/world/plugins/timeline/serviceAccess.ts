/**
 * timeline 芽的服务取值器。
 *
 * 与 notebook / mindmap / data-tools / characters 同一模式：插件经 `world.*` 服务取数
 * （唯一取数通道，换数据源只改 `services.ts`），收敛成单份避免每文件重复。取不到属
 * 时序被破坏的编程错误（服务在起树时登记，视图由树的注册表驱动挂载），故报错而非静默降级。
 */
import { getWorldService } from '../../service-registry'
import type {
  WorldDetailLayoutService,
  WorldEntitiesService,
  WorldRelationsService,
  WorldSchemaService,
  WorldSettingsService,
  WorldUiService,
} from '../../services'

export function entitiesSvc(): WorldEntitiesService {
  const svc = getWorldService<WorldEntitiesService>('world.entities')
  if (!svc) throw new Error('[timeline] world.entities 服务未就绪（视图渲染早于起树）')
  return svc
}

export function relationsSvc(): WorldRelationsService {
  const svc = getWorldService<WorldRelationsService>('world.relations')
  if (!svc) throw new Error('[timeline] world.relations 服务未就绪（视图渲染早于起树）')
  return svc
}

export function settingsSvc(): WorldSettingsService {
  const svc = getWorldService<WorldSettingsService>('world.settings')
  if (!svc) throw new Error('[timeline] world.settings 服务未就绪（视图渲染早于起树）')
  return svc
}

export function detailLayoutSvc(): WorldDetailLayoutService {
  const svc = getWorldService<WorldDetailLayoutService>('world.detailLayout')
  if (!svc) throw new Error('[timeline] world.detailLayout 服务未就绪（视图渲染早于起树）')
  return svc
}

export function schemaSvc(): WorldSchemaService {
  const svc = getWorldService<WorldSchemaService>('world.schema')
  if (!svc) throw new Error('[timeline] world.schema 服务未就绪（视图渲染早于起树）')
  return svc
}

export function uiSvc(): WorldUiService {
  const svc = getWorldService<WorldUiService>('world.ui')
  if (!svc) throw new Error('[timeline] world.ui 服务未就绪（视图渲染早于起树）')
  return svc
}
