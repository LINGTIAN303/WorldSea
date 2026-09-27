# model-fetcher.ts 详细注释文档（packages/agent-runtime/providers）

> 来源：`packages/agent-runtime/src/providers/model-fetcher.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-11 行）

```
动态模型拉取服务

通过各供应商的 /v1/models 端点动态获取可用模型列表。
拉取结果仅返回模型 ID 列表，由消费方与 MODEL_REGISTRY 合并。

特性：
- 结果缓存到 localStorage（24 小时过期），避免每次启动都拉取
- 支持手动刷新
- 未知模型使用合理默认值填充
```
