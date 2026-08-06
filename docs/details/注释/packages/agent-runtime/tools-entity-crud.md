# entity-crud.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/entity-crud.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-14 行）

```
实体 CRUD 工具集

提供实体的完整生命周期管理：
- entity_list: 列表查询（类型筛选 + 关键词筛选）
- entity_get: 根据 ID 获取详情
- entity_create: 创建实体（类型校验 + 去重检查）
- entity_update: 更新实体属性（合并更新）
- entity_delete: 删除实体及关联关系 + Embedding 索引清理
- entity_suggest_field: 字段级智能建议（接续预览 / 独立建议）
- entity_smart_fill: 实体级一键智能填充

创建/更新/删除后会自动同步 Embedding 向量索引。
```
