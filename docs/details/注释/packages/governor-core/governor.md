# governor.ts 详细注释

> 来源：`packages/governor-core/src/governor.ts`
> 说明：本文件为 governor-core 调控器核心实现内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-22 行）

```
/**
 * @worldsmith/governor-core — 调控器核心实现
 *
 * createGovernor() 工厂函数，实现 Governor 接口。
 *
 * 核心职责：
 *   1. 环境查询（委托 environment.ts）
 *   2. 模块注册（委托 ModuleRegistry）
 *   3. 模块激活/停用（通过 apiFactory 创建 GovernorAPI 后调用 descriptor.activate）
 *   4. 批量启动 boot()：按 priority 分批 + 依赖拓扑排序 + 分级降级
 *
 * 与 apps/web/src/governor/governor.ts 的差异：
 *   - 通过 options.apiFactory 注入 GovernorAPI 创建策略
 *   - 主应用传入 createGovernorAPI（依赖 Vue/Pinia）
 *   - Agent 包传入空 API 工厂（无 UI 依赖）
 *   - 由此消除主应用 governor 与 Agent 运行时包（@worldsmith/agent-runtime）的重复实现
 *
 * 分级降级策略：
 *   - critical：失败则中止 boot()，hasCriticalFailure=true
 *   - normal：失败记录到 failed，继续下一个
 *   - lazy：失败 console.warn，继续
 */
```

## 注释块 2（原文件第 78-87 行）

```
/**
 * 创建调控器实例。
 *
 * @param options 调控器选项
 *   - environment: 显式指定环境（默认自动检测）
 *   - activeModuleIds: 用户配置的激活模块白名单
 *   - verbose: 详细日志
 *   - apiFactory: GovernorAPI 创建工厂（默认返回空 API）
 * @returns Governor 实例
 */
```

## 注释块 3（原文件第 137-146 行）

```
/**
 * 激活单个模块。
 *
 * 流程：
 * 1. 检查是否已激活
 * 2. 检查环境匹配（hosts/phase/requires）
 * 3. 通过 apiFactory 创建 GovernorAPI
 * 4. 调用 descriptor.activate(api)
 * 5. 记录激活状态
 */
```
