# registry/tool-registry.ts 详细注释

> 来源：`packages/agent-core/src/registry/tool-registry.ts`
> 说明：本文件为 agent-core 工具注册中心内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

```
/**
 * 工具注册中心
 *
 * 基于声明式元数据的工具注册与查询。
 * 核心能力：
 * - 注册工具（含 ToolMeta 元数据）
 * - 按权限级别查询（替代硬编码 SAFE/MODERATE/DANGEROUS 列表）
 * - 按分类查询
 * - 按平台过滤
 * - 别名解析（旧工具名→新工具名）
 * - 始终可用工具自动聚合
 */
```
