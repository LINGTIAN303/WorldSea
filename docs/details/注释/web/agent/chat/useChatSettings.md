# useChatSettings.ts 详细注释

> 来源：`apps/web/src/agent/chat/useChatSettings.ts`
> 说明：本文件为 useChatSettings composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-11 行）

```
/**
 * useChatSettings — Agent 聊天设置（模型 / 温度 / persona / thinking / search / skills / mcp）
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - 设置项 state（temperature/maxTokens/contextLength/personaPreset/thinkingLevel/searchEngine/...）
 *   - 模型相关常量（THINKING_LEVELS / CHAT_MODES / maxOutputTokensForModel / ...）
 *   - 各类 onXxxChange 回调（模型/温度/persona/thinking/search/apikey/provider/skill/mcp）
 *   - 持久化（saveAgentSettings / loadAgentSettings / loadThinkingLevel / loadCurrentModel / saveSearchConfig / loadSearchConfig）
 *
 * 外部依赖通过 options 注入，避免与 useAgent / useMcpConnections 强耦合。
 */
```
