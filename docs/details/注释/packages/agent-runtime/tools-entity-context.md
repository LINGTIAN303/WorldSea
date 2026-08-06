# entity-context.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/entity-context.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-14 行）

```
实体上下文聚合工具

为 Agent 智能填充提供一站式上下文获取能力。
支持七种 scope 粒度，Agent 可按需选择全量获取或针对某一细节深入查找：

- full: 全量上下文（当前实体 + 关联实体 + 同类型实体 + Schema + 语义相关）
- relations_only: 仅关联实体与关系
- same_type_entities: 仅同类型已有实体
- schema_detail: 仅 Schema 字段定义
- semantic_related: 仅语义相关实体（需 Embedding 就绪）
- field_context: 仅指定字段的上下文（同字段值 + 关联实体中相关片段 + 字段 Schema）
- cross_type_relations: 仅与指定目标类型的跨类型关系
```
