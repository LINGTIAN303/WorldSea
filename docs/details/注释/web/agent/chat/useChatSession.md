# useChatSession.ts 详细注释

> 来源：`apps/web/src/agent/chat/useChatSession.ts`
> 说明：本文件为 useChatSession composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-14 行）

```
/**
 * useChatSession — 会话 drawer 的会话列表 / 切换 / 删除 / 新建
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - loadDrawerSessions：拉取会话列表
 *   - onDrawerSelect / onDrawerNewSession：切换 / 新建会话
 *   - onDrawerDelete：删除会话（含 H6.2 删除前归档 + 级联删除文境副本）
 *   - onSessionTitleUpdated：会话标题更新事件回调
 *
 * 依赖外部注入：
 *   - sessions / sessionDrawerOpen（来自 useChatPanel）
 *   - switchSession / newSession / currentSessionId（来自 useAgent）
 *   - cascadeDeleteManuscriptClones（来自 useManuscriptActions）
 */
```
