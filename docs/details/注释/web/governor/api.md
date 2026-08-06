# api.ts 详细注释

> 来源：`apps/web/src/governor/api.ts`
> 说明：本文件为 GovernorAPI 实现内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

```
/**
 * governor/api.ts — GovernorAPI 实现（Web 端迁移版）
 *
 * P3-W3 从根 src/governor/api.ts 迁移，实现不变。
 *
 * 包装现有 pluginAPI，附加环境上下文。
 * 模块通过此 API 注册实体类型/视图/关系，并查询环境能力。
 *
 * 关键设计：
 * - 每次激活模块前，调用 pluginAPI.setPluginId(module.id) 设置当前插件上下文
 * - GovernorAPI 在 pluginAPI 基础上增加 env/hasCapability/module 字段
 * - 注册方法直接委托 pluginAPI，保持向后兼容
 */
```
