# useMessageSpeaker.ts 详细注释

> 来源：`packages/shared-composables/src/agent/useMessageSpeaker.ts`
> 说明：本文件为 useMessageSpeaker 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-20 行）

````
/**
 * # useMessageSpeaker — 消息发言者信息（端无关 + 依赖注入）
 *
 * ## 职责
 * 统一获取消息的 speaker 信息（name / avatar / color / fontFamily）：
 * - 群聊消息：优先用 msg.speaker* 字段（GroupChatCoordinator 填充）
 * - 单聊 user 消息：从注入的 userProfile 读取
 * - 单聊 assistant 消息：从注入的 persona 读取
 *
 * ## 端分离设计（批次3）
 * 原实现直接依赖 `useSpaceStore` / `useUserProfileStore` / `usePersonaFontStore`
 * 等 Tauri/Web 特定 store，无法被 CLI 端复用。
 *
 * 改造为依赖注入模式：
 * - 各端入口在应用启动时调用 `provideMessageSpeakerContext(ctx)` 注入具体实现
 * - 共享代码通过 `useMessageSpeaker()` 自动获取注入的上下文
 * - 上下文字段使用 ComputedRef 包装，保持响应性
 *
 * 端分离批次3：从 src/agent/composables/useMessageSpeaker.ts 迁移至 shared-composables。
 */
````

## 注释块 2（原文件第 100-109 行）

````
/**
 * 统一获取消息的 speaker 信息
 *
 * 数据流统一（迭代点 2）：
 * - 群聊消息：优先用 msg.speaker* 字段（GroupChatCoordinator 填充）
 * - 单聊消息：从注入的上下文读（assistant→persona + accentColor，user→userProfile）
 *
 * 配合 AvatarBadge 组件使用：AvatarBadge 内部 useAvatarImage 自动解析 avatar（图片/引用）为 src，
 * 无图片时显示文字（avatar/name 首字）+ 背景色。
 */
````
