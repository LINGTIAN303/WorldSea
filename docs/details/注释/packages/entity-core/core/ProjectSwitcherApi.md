# ProjectSwitcherApi.ts 详细注释

> 来源：`packages/entity-core/src/core/ProjectSwitcherApi.ts`
> 说明：本文件为 ProjectSwitcherApi 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-10 行）

````
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
````
