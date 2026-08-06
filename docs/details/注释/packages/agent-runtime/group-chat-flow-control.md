# flow-control.ts 详细注释文档（packages/agent-runtime/group-chat）

> 来源：`packages/agent-runtime/src/group-chat/flow-control.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-10 行）

```
群聊控流系统

实现三级限流：全局 → ProviderSlot → Agent。
使用 Token Bucket（请求频率）+ Concurrency Limiter（并发数）组合控制。
请求排队等待而非直接拒绝，保证群聊不会因并发过高导致 API 超载。

附加通用退避重试层（retryWithBackoff），任何供应商返回 429/503/529
时自动指数退避重试，无需逐个适配。
```

## 注释块 2（原文件第 73-83 行）

```
通用退避重试执行器

包装任意异步操作，遇到 429/503/529 时自动指数退避重试。
适用于所有供应商，无需逐个适配。

@param fn 要执行的异步操作
@param config 重试配置
@returns fn 的返回值
@throws 超过最大重试次数后抛出最后一次错误
```
