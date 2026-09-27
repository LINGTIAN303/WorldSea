# model-registry.ts 详细注释文档（packages/agent-runtime/providers）

> 来源：`packages/agent-runtime/src/providers/model-registry.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
模型注册表

包含所有支持的 LLM 模型元数据（上下文窗口、价格、能力等），
以及查询/筛选/成本计算等工具函数。

注：与 session/types.ts 的 RuntimeModelInfo（运行时模型快照）语义不同。
- ModelInfo（本文件）：模型注册表条目，静态元数据，字段完整
- RuntimeModelInfo：运行时模型快照，从 Rust payload 构造，字段精简
```
