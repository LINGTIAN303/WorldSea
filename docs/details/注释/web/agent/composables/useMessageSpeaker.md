# useMessageSpeaker.ts 详细注释

> 来源：`apps/web/src/agent/composables/useMessageSpeaker.ts`
> 说明：本文件为 useMessageSpeaker 函数内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 26-37 行）

```
/**
 * 统一获取消息的 speaker 信息
 *
 * 数据流统一（迭代点 2）：
 * - 群聊消息：优先用 msg.speaker* 字段（GroupChatCoordinator 填充）
 * - 单聊消息：从 store 读（assistant→spaceStore.persona + accentColor，user→userProfileStore）
 *
 * 配合 AvatarBadge 组件使用：AvatarBadge 内部 useAvatarImage 自动解析 avatar（图片/引用）为 src，
 * 无图片时显示文字（avatar/name 首字）+ 背景色。
 *
 * 直接用 usePersonaFontStore（而非 usePersonaFont composable）避免字体加载副作用。
 */
```
