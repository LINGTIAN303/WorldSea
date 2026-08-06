# deps.ts 详细注释

> 来源：`packages/shared-composables/src/agent/deps.ts`
> 说明：本文件为 deps 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-18 行）

````
/**
 * Agent UI 端依赖注入契约（deps）
 *
 * 用途：将 `bubbles` 系列共享组件（DeepMessageArea / NormalMessageBubble /
 * useMarkdownRender / useMessageExport）对 Web 应用层资源的依赖，改为
 * 通过 provide/inject 注入，使共享层不直接依赖任何端特定实现。
 *
 * 被注入的 Web 应用层资源（原实现位置）：
 * - `fontFamily` / `enterAnimation` / `persona`：来自 `usePersonaFont`（apps/web/src/space/composables）
 * - `fontPrefs`：来自 `fontStore.prefs.agent`（apps/web/src/stores/fontStore）
 * - `activityLogs`：来自 `useActivityLog`（apps/web/src/space/composables）
 * - `replaceFontSpans`：来自 `fontSpanParser`（apps/web/src/composables/fontSpanParser）
 * - `AvatarBadge`：来自 `../ui/AvatarBadge.vue`（apps/web/src/ui）
 *
 * 设计：与 `useMessageSpeaker` 的 provide/inject 模式保持一致。
 * 各端入口在应用启动时调用 `provideAgentUiDeps(...)` 注入具体实现；
 * 共享组件通过 `useAgentUiDeps()` 获取。
 */
````
