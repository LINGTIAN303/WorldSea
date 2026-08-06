/** 项目切换服务接口（entity-core 定义、根项目注册实现，Phase 5 依赖注入解耦），详细见 docs/details/注释/packages/entity-core/core/ProjectSwitcherApi.md */

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
