# index.ts 详细注释

> 来源：`packages/agent-core/src/index.ts`
> 说明：本文件为 agent-core 库入口内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-18 行）

```
/**
 * @worldsmith/agent-core — Agent 运行时核心库
 *
 * 基于 PI 框架的 Agent 核心抽象层，提供：
 * - 声明式工具元数据系统（ToolMeta）
 * - 统一权限守卫（PermissionGuard）
 * - 工具注册中心（ToolRegistry）
 * - 技能注册中心（SkillRegistry）
 * - 工具总线（ToolBus）
 * - 执行适配器接口（ExecutionAdapter）
 * - Agent 工厂契约
 *
 * 设计原则：
 * - 新增工具时只需在 ToolMeta 中声明权限/分类/平台，自动传播到所有消费方
 * - 权限守卫从元数据自动解析，取代散落在各处的硬编码列表
 * - 技能定义声明式，取代巨型单文件硬编码数组
 * - 核心库零外部依赖，具体实现由消费方注入
 */
```
