/**
 * ModuleStoreApi — 模块存储服务接口
 *
 * Phase 5 依赖注入：ProjectFS 需要操作模块数据（getAll/install），
 * 但 moduleStore 实现位于根 src/modules/store.ts（依赖项目级数据库）。
 * 通过此接口解耦：entity-core 定义接口，根项目启动时注册实现。
 * 遵循 entity-core 已有的服务注册模式（registerEventBus/getEventBus 等）。
 */
import type { ModuleInstance } from './database'

/** 模块存储服务接口（ProjectFS 所需的最小子集） */
export interface ModuleStoreApi {
  /** 获取所有模块实例 */
  getAll(): Promise<ModuleInstance[]>
  /** 安装/更新一个模块实例 */
  install(mod: ModuleInstance): Promise<void>
}

let _moduleStoreApi: ModuleStoreApi | null = null

/** 注册模块存储服务实现（根项目启动时调用） */
export function registerModuleStoreApi(api: ModuleStoreApi): void {
  _moduleStoreApi = api
}

/** 获取已注册的模块存储服务，未注册时返回 null */
export function getModuleStoreApi(): ModuleStoreApi | null {
  return _moduleStoreApi
}
