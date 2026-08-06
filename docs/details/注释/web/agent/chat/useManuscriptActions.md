# useManuscriptActions.ts 详细注释

> 来源：`apps/web/src/agent/chat/useManuscriptActions.ts`
> 说明：本文件为 useManuscriptActions composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-10 行）

```
/**
 * useManuscriptActions — 文境（Manuscript）Block 本地操作
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - 文境 block 的本地状态变更（resize / layout / shadow / animation）
 *   - 仅持久化到内存中的 block 数据，不发送到 Agent
 *   - formatBlockActionDisplay：格式化 block 动作的展示文本
 *
 * 与 useAgent.messages 直接交互（修改 block 字段）。
 */
```
