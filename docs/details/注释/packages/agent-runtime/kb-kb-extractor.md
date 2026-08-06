# kb-extractor.ts 详细注释文档（packages/agent-runtime/kb）

> 来源：`packages/agent-runtime/src/kb/kb-extractor.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-12 行）

```
自动记忆提取器

在对话结束后自动分析对话内容，识别值得持久化的知识，
并写入知识库或 localStorage 记忆。

提取策略：
1. 基于规则的快速提取（关键词匹配、模式识别）
2. 提取结果分类（preference/decision/convention/insight/rule/pattern）
3. 去重检查（避免重复写入已有知识）
4. 写入知识库（长文档）或 localStorage 记忆（短片段）
```
