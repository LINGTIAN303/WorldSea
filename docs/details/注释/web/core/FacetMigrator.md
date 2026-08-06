# FacetMigrator.ts 详细注释

> 来源：`apps/web/src/core/FacetMigrator.ts`
> 说明：本文件为 FacetMigrator 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 37-48 行）

```
/**
 * 将旧版 weapon/apparel 类型实体迁移为 item + facet 结构
 *
 * 迁移逻辑：
 * 1. 查找所有 type='weapon' 和 type='apparel' 的实体
 * 2. 将武器特有字段提取到 facets.weapon，服饰特有字段提取到 facets.apparel
 * 3. 通用字段（material, color, origin, era, condition, tags 等）保留在 properties
 * 4. 设置 itemType 字段区分类型
 * 5. 更新实体 type 为 'item'
 * 6. 更新关联关系中的引用
 * 7. 记录迁移完成标记
 */
```
