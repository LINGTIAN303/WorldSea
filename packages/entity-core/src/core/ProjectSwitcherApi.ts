/**
 * ProjectSwitcherApi — 项目切换服务接口
 *
 * Phase 5 依赖注入：ProjectFS.importProjectFromDir 需要切换到新创建的项目，
 * 但 useProjectSwitcher 实现位于根 src/composables/useProjectSwitcher.ts，
 * 依赖大量根目录模块（moduleRegistry、memoryArchive、agent session 等）。
 *
 * 通过此接口解耦：entity-core 定义接口，根项目启动时注册实现。
 * 遵循 entity-core 已有的服务注册模式（registerEventBus/getEventBus 等）。
 */

/** 项目切换服务接口（ProjectFS 所需的最小子集） */
export interface ProjectSwitcherApi {
  /** 切换到指定项目，返回是否切换成功 */
  switchProject(targetProjectId: string): Promise<boolean>
}

let _projectSwitcherApi: ProjectSwitcherApi | null = null

/** 注册项目切换服务实现（根项目启动时调用） */
export function registerProjectSwitcherApi(api: ProjectSwitcherApi): void {
  _projectSwitcherApi = api
}

/** 获取已注册的项目切换服务，未注册时返回 null */
export function getProjectSwitcherApi(): ProjectSwitcherApi | null {
  return _projectSwitcherApi
}
