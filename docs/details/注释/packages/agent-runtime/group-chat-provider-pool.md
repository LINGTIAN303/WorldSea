# provider-pool.ts 详细注释文档（packages/agent-runtime/group-chat）

> 来源：`packages/agent-runtime/src/group-chat/provider-pool.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-11 行）

```
Provider 池管理

ProviderSlot 是 AgentProfile 和 ProviderConfig 之间的间接层。
一个 Pool 包含多个 Entry（API 连接配置），通过负载均衡策略选择使用哪个。

典型场景：
- 同一厂商多个 API Key 分摊速率限制
- 同厂商不同模型供不同 Agent 使用
- 多个自定义端点实例
```
