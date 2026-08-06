# backend.rs 详细注释文档（agent-runtime）

> 来源：`crates/agent-runtime/src/backend.rs` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 76-85 行）

热切换 Provider 配置（不清空消息历史）

默认返回 `BackendError::Unsupported`，由支持热切换的 backend 覆盖。
对应前端 `IAgentBackend.updateModel` 接口。

# 参数
- `provider`：Provider ID（如 "deepseek"/"openai"/"anthropic"）
- `model_id`：模型 ID（如 "deepseek-v4-flash"）
- `api_key`：API Key（None=保持原值）
- `base_url`：自定义 base URL（None=使用 Provider 默认）
