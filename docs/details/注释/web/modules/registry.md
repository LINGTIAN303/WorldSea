# registry.ts 详细注释

> 来源：`apps/web/src/modules/registry.ts`
> 说明：本文件为模块注册表内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

```
/**
 * modules/registry.ts — 模块注册表（Web 端迁移版）
 *
 * P3-W2 从根 src/modules/registry.ts 迁移。实现不变，唯一裁剪：
 * - KanbanView 组件动态加载（根目录 src/modules/runtime/KanbanView.vue 属 P3-W3 核心页面批次，
 *   此处先跳过看板视图扩展注册，P3-W3 恢复）
 *
 * 核心调度器。负责：
 *   - 模块的激活/停用
 *   - 依赖解析（拓扑排序）
 *   - FieldExtension / ViewExtension 注册
 *   - 生命周期管理
 */
```
