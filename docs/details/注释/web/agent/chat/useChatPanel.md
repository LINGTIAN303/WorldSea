# useChatPanel.ts 详细注释

> 来源：`apps/web/src/agent/chat/useChatPanel.ts`
> 说明：本文件为 useChatPanel composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-11 行）

```
/**
 * useChatPanel — Agent 聊天面板状态管理（位置 / 大小 / 最小化 / 折叠）
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - 面板坐标（panelX/panelY/panelW/panelH）的拖拽与缩放
 *   - 最小化 / 穿透（pin）切换
 *   - 面板状态持久化（agent_panel）
 *   - clampPanelY / clampPanelX / maxPanelH 等边界计算
 *
 * 注意：isPinned 来自 useAgent（全局单例），故作为参数传入而非在此处创建。
 */
```
