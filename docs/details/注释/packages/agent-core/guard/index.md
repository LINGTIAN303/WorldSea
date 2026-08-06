# guard/index.ts 详细注释

> 来源：`packages/agent-core/src/guard/index.ts`
> 说明：本文件为 agent-core 统一权限守卫内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-11 行）

```
/**
 * 统一权限守卫
 *
 * 从工具元数据自动解析权限级别，取代 useAgent.ts / cli-safety-guard.ts
 * 中的硬编码列表。新增工具时只需在 ToolMeta 中声明权限，自动传播到所有消费方。
 *
 * 用法：
 *   const guard = new PermissionGuard(toolRegistry)
 *   const level = guard.resolvePermission('shell_session', { action: 'exec', command: 'rm -rf /' })
 *   // → 'dangerous'
 */
```

## 注释块 2（原文件第 78-87 行）

```
/**
 * 解析工具调用的最终权限级别
 *
 * 解析优先级：
 * 1. permissionOverrides（最高优先）
 * 2. 子命令级别权限覆盖（subCommandPermissions）
 * 3. 危险命令模式检测（dangerousPatterns + 全局 dangerousCommandPatterns）
 * 4. 工具声明的默认权限（meta.permission）
 * 5. 兜底为 moderate
 */
```
