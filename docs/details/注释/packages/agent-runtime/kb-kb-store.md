# kb-store.ts 详细注释文档（packages/agent-runtime/kb）

> 来源：`packages/agent-runtime/src/kb/kb-store.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-12 行）

```
知识库存储层

基于 IndexedDB 的知识库存储，支持双层作用域：
- global: 跨项目持久（用户画像、偏好、模式）
- project: 项目级持久（世界观知识、实体洞察、决策记录）

数据模型：
- KBEntry: 知识条目（id/path/scope/content/tags/entityId/时间戳/访问统计）
- 存储在 IndexedDB 'worldsea_kb' 数据库中
- 按 scope + path 唯一索引
```
