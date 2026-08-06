# memory.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/memory.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-19 行）

```
长期记忆模块

基于 localStorage + Embedding 向量搜索的双层记忆系统：
1. localStorage 存储完整的 MemoryEntry 数组（key/value/tags/timestamp）
2. Embedding 向量索引用于语义搜索（可选）

提供三个工具：memory_store（存储）、memory_recall（检索）、memory_delete（删除）

检索模式：
- keyword: 纯关键词匹配
- semantic: 纯语义向量搜索（需要 Embedding API）
- hybrid: 混合模式——关键词召回 + 语义召回合并排序

容量控制：
- 最多 200 条记忆
- 单条 value 最多 2000 字符
- 超出上限时按 accessCount + lastAccessedAt 加权淘汰
```

## 注释块 2（原文件第 28-37 行）

```
关键词检索

评分规则：
- key 包含关键词: +3
- value 包含关键词: +2
- tag 精确匹配: +4
- tag 包含关键词: +1
- accessCount 加权: +0.1 每访问次数
```

## 注释块 3（原文件第 53-64 行）

```
统一的记忆召回函数（混合模式核心）

流程：
1. 执行关键词召回
2. 如果 Embedding 可用，执行语义召回
3. 合并两路结果（取最高分）
4. 更新记忆的 accessCount

@param query 搜索关键词
@param limit 返回数量上限
```
