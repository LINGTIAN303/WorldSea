# AvatarBadge.vue 详细注释

> 来源：`apps/web/src/ui/AvatarBadge.vue`
> 说明：本文件为统一头像组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 13-26 行）

```
/**
 * 统一头像组件
 *
 * 替代多处分散的头像渲染（SpaceNavbar agent-avatar / UserProfilePopover profile-avatar /
 * CreateAgentDialog avatar-circle / GroupMessageBubble speaker-avatar / AgentMessageBubble msg-icon）。
 *
 * 渲染规则：
 * - avatar 为图片源（URL/base64/`avatar://` 引用）→ 内部 useAvatarImage 解析为可显示 src → 显示 <img>
 * - avatar 为文字/空 → 显示文字（avatar 文字 或 name 首字 或 '?'）+ 背景色
 * - 外部 src prop（若有）优先级最高，覆盖内部解析（用于外部已解析的直接图片）
 *
 * `avatar://xxx` 存储引用由内部 useAvatarImage 异步解析为 object URL（含生命周期管理），
 * 调用方只需传 avatar 原值，无需自行解析。
 */
```
