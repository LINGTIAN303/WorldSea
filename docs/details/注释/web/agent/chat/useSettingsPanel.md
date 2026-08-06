# useSettingsPanel.ts 详细注释

> 来源：`apps/web/src/agent/chat/useSettingsPanel.ts`
> 说明：本文件为 useSettingsPanel composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

```
/**
 * useSettingsPanel — Agent 设置浮窗的位置 / 拖拽 / 开关
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - settingsPos / settingsDragged 状态
 *   - usePanelDrag 集成（排除设置浮窗内部交互区域）
 *   - updateSettingsPosition：根据输入栏 menu 按钮位置定位
 *   - onToggleSettings：打开/关闭设置浮窗
 *
 * 依赖外部 inputBarRef（用于读取菜单按钮位置）和 useAgentCommands 的
 * settingsOpen / openSettings / closeSettings。
 */
```
