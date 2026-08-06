# useMarkdownRender.ts 详细注释

> 来源：`packages/shared-ui/src/agent/bubbles/useMarkdownRender.ts`
> 说明：本文件为 useMarkdownRender 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

````
/**
 * Markdown 渲染 composable（共享层）
 *
 * 从 apps/web/src/agent/bubbles/useMarkdownRender.ts 迁移。
 * 封装：marked 解析 → DOMPurify 消毒 → 实体名 mention 注入，
 * 并用 useStreamingRenderer 对流式输出做 rAF 节流。
 *
 * 端解耦：`replaceFontSpans`（{font:...} 标记替换）通过 `useAgentUiDeps()` 注入式获取，
 * 不再直接依赖 Web 端 fontSpanParser。
 *
 * 模块级共享：marked 实例、DOMPurify hook、mention 注入缓存，
 * 避免每个消息气泡重复创建。
 */
````
