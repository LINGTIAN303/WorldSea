# index.ts 详细注释文档（packages/agent-runtime）

> 来源：`packages/agent-runtime/src/index.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-18 行）

```
@worldsmith/agent-runtime 包入口

端无关的 Agent 运行时，包含：
- Agent 创建和配置
- 工具定义和类型
- 会话管理
- 上下文构建和注入
- Skill 注册管理
- Provider 配置和 Key 存储
- Embedding（向量嵌入）服务
- 图像生成和持久化
- ExecutionAdapter 接口和工厂注册
- 日志和限流

端特定代码（Node/Tauri/WebSocket adapter）不在此包中，
由各端入口通过 registerExecutionAdapterFactory 注入。
```
