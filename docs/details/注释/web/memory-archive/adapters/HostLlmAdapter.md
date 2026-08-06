# HostLlmAdapter.ts 详细注释

> 来源：`apps/web/src/memory-archive/adapters/HostLlmAdapter.ts`
> 说明：本文件为 LlmAdapter 宿主实现内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-15 行）

```
/**
 * HostLlmAdapter - LlmAdapter 接口的宿主实现
 *
 * 对接 worldsmith-agent 的 AI Provider 系统，调用 LLM 生成高质量摘要。
 * 支持所有 OpenAI 兼容的 provider（DeepSeek/OpenAI/Zhipu 等）。
 *
 * 当 LLM 不可用时（provider 未配置/API 调用失败），所有方法抛出错误，
 * 框架会自动降级到 RuleBasedLlmAdapter（规则提取）。
 *
 * 工作流程：
 * 1. 从 useAgent.getProviderConfig() 获取当前 provider 配置
 * 2. 使用 resolveModel() 解析为统一的 ResolvedModel
 * 3. 构建 OpenAI 兼容的 chat completion 请求
 * 4. 调用 API 并解析响应
 */
```
