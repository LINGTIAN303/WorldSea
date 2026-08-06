# governor.ts 详细注释文档（packages/agent-runtime）

> 来源：`packages/agent-runtime/src/governor.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-15 行）

```
@worldsmith/agent-runtime/src/governor.ts — Agent 运行时包轻量调控器入口

为 Agent 包（Web 端 + CLI 端）提供基于 governor 的模块编排。

与主应用 governor 的关系：
- 核心逻辑复用 @worldsmith/governor-core（createGovernor/ModuleRegistry/...）
- 主应用通过 apps/web/src/governor/governor.ts 包装 governor-core 并注入 createGovernorAPI
- Agent 包直接使用 governor-core 的 createGovernor（默认空 apiFactory，无 UI 依赖）
- 由此消除主应用 governor 与 Agent 运行时包 governor 的重复实现

使用方式：
  import { bootAgentGovernor } from '@worldsmith/agent-runtime'
  const governor = await bootAgentGovernor()
```

## 注释块 2（原文件第 206-216 行）

```
确保全局 Agent 调控器已初始化并完成 boot。

- 若全局实例未初始化，则用给定 options 创建（options 为空时使用默认策略）
- 若全局实例已初始化但未 boot，则执行 boot
- 若全局实例已 boot，则直接返回（幂等）

@param options 创建选项（仅在首次创建时生效）
@returns 已 boot 的 AgentGovernor 实例
@throws 当 critical 模块激活失败时抛出
```
