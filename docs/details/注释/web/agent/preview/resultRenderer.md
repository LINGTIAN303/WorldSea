# resultRenderer.ts 详细注释

> 来源：`apps/web/src/agent/preview/resultRenderer.ts`
> 说明：本文件为 resultRenderer 纯函数模块内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-11 行）

```
/**
 * AgentPreview 工具调用结果的 HTML 渲染器
 *
 * 从 AgentPreview.vue 中提取的纯函数模块。
 * 负责将工具调用的 JSON 字符串结果渲染为带样式的 HTML 字符串，
 * 并通过 DOMPurify 消毒后供 v-html 使用。
 *
 * 注：render* 函数处理的 obj 来自任意工具返回的 JSON，
 * 结构高度动态，故保留 any 类型（必要时例外），
 * 出口统一经 DOMPurify.sanitize 消毒，不存在 XSS 风险。
 */
```
